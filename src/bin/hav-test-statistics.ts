// Checks that the database behind this environment supports every operation the
// statistics feature depends on, by running the real code paths against it and
// asserting the documents they leave behind.
//
// Worth running once per environment, because Statistics.record() swallows its
// own failures by design: an unsupported write would otherwise be invisible
// until someone noticed a counter was missing.
//
// Creates and removes its own documents under reserved site ids and touches
// nothing else, so it is safe to run anywhere.

import assert from 'node:assert';
import type { Db } from 'mongodb';
import command from '../lib/command.ts';
import { Statistics } from '../lib/statistics.ts';
import { confirmSubscription, deleteSubscription } from '../lib/subscriptionActions.ts';
import { expireSubscriptions } from '../lib/subscriptionExpiry.ts';
import mongodb from '../plugins/mongodb.ts';
import statisticsPlugin from '../plugins/statistics.ts';
import type { StatisticsCollectionType } from '../types/statistics.ts';
import { type SubscriptionCollectionType, SubscriptionStatus } from '../types/subscription.ts';

/** Not a configured site, so no cron or endpoint will ever look at these rows. */
const SITE = 'hav-verify';
/** Second site whose id starts with the first, for the _id range scan. */
const NEIGHBOUR = `${SITE}2`;

const longAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);

const subscriptionRow = (overrides: Partial<SubscriptionCollectionType> = {}): SubscriptionCollectionType => ({
  email: SITE,
  atv_id: SITE,
  elastic_query: SITE,
  query: `/${SITE}`,
  site_id: SITE,
  hash: SITE,
  lang: 'fi',
  status: SubscriptionStatus.INACTIVE,
  expiry_notification_sent: SubscriptionStatus.INACTIVE,
  created: new Date(),
  modified: new Date(),
  sms_secret: SITE,
  ...overrides,
});

interface Check {
  /** The database capability being proved. */
  name: string;
  run: (db: Db, statistics: Statistics) => Promise<void>;
}

const checks: Check[] = [
  {
    name: 'upsert with $inc on dotted paths and $setOnInsert (counter write)',
    run: async (db, statistics) => {
      await statistics.record(SITE, 'created', { lang: 'fi' });

      const document = await counters(db);
      assert.ok(document, 'no statistics document was written');
      assert.strictEqual(document.site_id, SITE);
      assert.strictEqual(document.day, Statistics.day());
      assert.ok(document.created instanceof Date, 'created was not stored as a date');
      assert.strictEqual(document.events?.created, 1);
      assert.strictEqual(document.lang?.fi?.created, 1);
    },
  },
  {
    name: 'repeated $inc accumulates without re-firing $setOnInsert',
    run: async (db, statistics) => {
      await statistics.record(SITE, 'created', { lang: 'fi' });
      await statistics.record(SITE, 'created', { lang: 'fi' });
      await statistics.record(SITE, 'created', { lang: 'sv' });

      const document = await counters(db);
      assert.strictEqual(document?.events?.created, 3);
      assert.strictEqual(document?.lang?.fi?.created, 2);
      assert.strictEqual(document?.lang?.sv?.created, 1);
      // The language keys must partition the total exactly.
      assert.strictEqual(document.lang.fi.created + document.lang.sv.created, document.events?.created);
    },
  },
  {
    name: '$set of a nested object (daily snapshot)',
    run: async (db, statistics) => {
      await statistics.recordSnapshot(SITE, { active: 42, unconfirmed: 7 });
      await statistics.recordSnapshot(SITE, { active: 43, unconfirmed: 6 });

      const document = await counters(db);
      assert.strictEqual(document?.snapshot?.active, 43, 'the last write of the day should win');
      assert.strictEqual(document?.snapshot?.unconfirmed, 6);
      assert.ok(document?.snapshot?.at instanceof Date);
    },
  },
  {
    name: "findOneAndUpdate with returnDocument: 'before' (confirmation)",
    run: async (db, statistics) => {
      const collection = db.collection<SubscriptionCollectionType>('subscription');
      const { insertedId } = await collection.insertOne(
        subscriptionRow({ email_confirmed: false, sms_confirmed: false }),
      );

      // Both channels of one subscription: this must count as one activation.
      await confirmSubscription(collection, { _id: insertedId }, 'email', statistics);
      await confirmSubscription(collection, { _id: insertedId }, 'sms', statistics);

      const row = await collection.findOne({ _id: insertedId });
      assert.strictEqual(row?.status, SubscriptionStatus.ACTIVE, 'the subscription was not activated');
      assert.strictEqual(row?.email_confirmed, true);
      assert.strictEqual(row?.sms_confirmed, true);

      assert.strictEqual(
        (await counters(db))?.events?.confirmed,
        1,
        'a two-channel confirmation must increment confirmed exactly once',
      );
    },
  },
  {
    name: 'findOneAndUpdate still reports a miss (404 path)',
    run: async (db, statistics) => {
      const collection = db.collection<SubscriptionCollectionType>('subscription');
      const { insertedId } = await collection.insertOne(subscriptionRow({ email_confirmed: true }));

      // Already confirmed, so the filter matches nothing and this must throw.
      await assert.rejects(
        () => confirmSubscription(collection, { _id: insertedId }, 'email', statistics),
        'a repeat confirmation must be rejected, not silently accepted',
      );

      assert.strictEqual(await counters(db), null, 'a rejected confirmation must record nothing');
    },
  },
  {
    name: 'findOneAndDelete returning the deleted document (cancellation)',
    run: async (db, statistics) => {
      const collection = db.collection<SubscriptionCollectionType>('subscription');
      const active = await collection.insertOne(subscriptionRow({ status: SubscriptionStatus.ACTIVE }));
      const unconfirmed = await collection.insertOne(subscriptionRow({ lang: 'en' }));

      await deleteSubscription(collection, { _id: active.insertedId }, statistics);
      await deleteSubscription(collection, { _id: unconfirmed.insertedId }, statistics);

      const document = await counters(db);
      assert.strictEqual(document?.events?.cancelled, 1, 'a live cancellation was not distinguished');
      assert.strictEqual(document?.events?.cancelled_unconfirmed, 1, 'an abandoned signup was not distinguished');
      assert.strictEqual(document?.lang?.en?.cancelled_unconfirmed, 1);
    },
  },
  {
    name: 'aggregate with $match and $group (expiry language split)',
    run: async (db, statistics) => {
      await db
        .collection('subscription')
        .insertMany([
          subscriptionRow({ status: SubscriptionStatus.ACTIVE, created: longAgo }),
          subscriptionRow({ status: SubscriptionStatus.ACTIVE, created: longAgo }),
          subscriptionRow({ status: SubscriptionStatus.ACTIVE, created: longAgo, lang: 'sv' }),
        ]);

      const deleted = await expireSubscriptions(db, statistics, {
        siteId: SITE,
        status: SubscriptionStatus.ACTIVE,
        olderThanDays: 90,
        isDryRun: false,
      });

      assert.strictEqual(deleted, 3, 'the expired subscriptions were not deleted');

      const document = await counters(db);
      assert.strictEqual(document?.events?.expired, 3);
      // A degraded aggregation loses the split but still deletes, so this is the
      // assertion that separates "worked" from "silently fell back".
      assert.strictEqual(document?.lang?.fi?.expired, 2, 'the language split was not recorded');
      assert.strictEqual(document?.lang?.sv?.expired, 1);
    },
  },
  {
    name: '_id range scan with sort, and its prefix safety',
    run: async (db) => {
      await db.collection<StatisticsCollectionType>('statistics').insertMany([
        dayDocument(SITE, '2020-01-02'),
        dayDocument(SITE, '2020-01-01'),
        // Must not be read as this site's, despite sharing its prefix.
        dayDocument(NEIGHBOUR, '2020-01-01'),
      ]);

      // Exactly the query the /stats endpoint uses.
      const documents = await db
        .collection<StatisticsCollectionType>('statistics')
        .find({ _id: { $gte: `${SITE}:2020-01-01`, $lte: `${SITE}:2020-01-31` } })
        .sort({ _id: 1 })
        .toArray();

      assert.deepStrictEqual(
        documents.map((document) => document._id),
        [`${SITE}:2020-01-01`, `${SITE}:2020-01-02`],
        'the range scan must return this site only, in ascending day order',
      );

      const earliest = await db
        .collection<StatisticsCollectionType>('statistics')
        .find({ _id: { $gte: `${SITE}:`, $lt: `${SITE};` } })
        .sort({ _id: 1 })
        .limit(1)
        .next();

      assert.strictEqual(earliest?.day, '2020-01-01', 'collecting_since would be wrong');
    },
  },
  {
    name: 'countDocuments with a compound filter (live counts)',
    run: async (db) => {
      await db
        .collection('subscription')
        .insertMany([
          subscriptionRow({ status: SubscriptionStatus.ACTIVE }),
          subscriptionRow({ status: SubscriptionStatus.ACTIVE }),
          subscriptionRow({ status: SubscriptionStatus.INACTIVE }),
        ]);

      const active = await db
        .collection('subscription')
        .countDocuments({ site_id: SITE, status: SubscriptionStatus.ACTIVE });
      const unconfirmed = await db
        .collection('subscription')
        .countDocuments({ site_id: SITE, status: SubscriptionStatus.INACTIVE });

      assert.strictEqual(active, 2);
      assert.strictEqual(unconfirmed, 1);
    },
  },
];

const dayDocument = (siteId: string, day: string): StatisticsCollectionType => ({
  _id: `${siteId}:${day}`,
  site_id: siteId,
  day,
  created: new Date(),
});

/** Today's counters for the reserved site. */
const counters = (db: Db): Promise<StatisticsCollectionType | null> =>
  db.collection<StatisticsCollectionType>('statistics').findOne({ _id: `${SITE}:${Statistics.day()}` });

/** Removes everything this command has written, so each check starts clean. */
async function reset(db: Db): Promise<void> {
  const sites = { $in: [SITE, NEIGHBOUR] };

  await db.collection<StatisticsCollectionType>('statistics').deleteMany({ site_id: sites });
  await db.collection<SubscriptionCollectionType>('subscription').deleteMany({ site_id: sites });
}

command(
  async (server) => {
    const db = server.mongo.db;
    if (!db) {
      throw new Error('MongoDB connection not available');
    }

    console.log(`Verifying statistics support against the database of '${process.env.ENVIRONMENT || 'dev'}'\n`);

    const failed: string[] = [];

    try {
      for (const check of checks) {
        await reset(db);

        try {
          await check.run(db, server.statistics);
          console.log(`  ok    ${check.name}`);
        } catch (error) {
          failed.push(check.name);
          console.error(`  FAIL  ${check.name}`);
          console.error(`        ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } finally {
      await reset(db);
    }

    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);

    if (failed.length > 0) {
      throw new Error(`Unsupported or misbehaving: ${failed.join('; ')}`);
    }

    console.log('This database supports every operation the statistics feature needs.');
  },
  [mongodb, statisticsPlugin],
);
