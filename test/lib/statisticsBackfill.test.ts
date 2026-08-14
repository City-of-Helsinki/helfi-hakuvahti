import * as assert from 'node:assert';
import { after, before, beforeEach, describe, test } from 'node:test';
import { type Db, MongoClient } from 'mongodb';
import { Statistics } from '../../src/lib/statistics.ts';
import { backfillStatistics } from '../../src/lib/statisticsBackfill.ts';
import type { StatisticsCollectionType } from '../../src/types/statistics.ts';
import { createSubscription } from './utils.ts';

const SITE = 'test-site';

const daysAgo = (count: number): Date => new Date(Date.now() - count * 24 * 60 * 60 * 1000);

describe('backfillStatistics', () => {
  assert.ok(process.env.MONGODB);
  const mongo = new MongoClient(process.env.MONGODB);

  let db: Db;

  before(async () => {
    await mongo.connect();
    db = mongo.db();
  });

  after(async () => {
    await mongo.close();
  });

  beforeEach(async () => {
    await db.collection('subscription').deleteMany({});
    await db.collection('statistics').deleteMany({ site_id: SITE });
  });

  const backfill = (isDryRun = false) => backfillStatistics(db, { siteId: SITE, isDryRun });

  const stored = (): Promise<StatisticsCollectionType[]> =>
    db.collection<StatisticsCollectionType>('statistics').find({ site_id: SITE }).sort({ _id: 1 }).toArray();

  /** A day for which live collection has recorded something. */
  const liveDay = async (day: string) => {
    await db.collection<StatisticsCollectionType>('statistics').insertOne({
      _id: `${SITE}:${day}`,
      site_id: SITE,
      day,
      created: new Date(),
      snapshot: { at: new Date(), active: 7, unconfirmed: 0 },
    });
  };

  test('reconstructs confirmations on the day each subscription was created', async () => {
    const day = Statistics.day(daysAgo(40));
    await db.collection('subscription').insertMany([
      createSubscription({ site_id: SITE, first_created: daysAgo(40) }),
      createSubscription({ site_id: SITE, first_created: daysAgo(40), lang: 'sv' }),
    ]);

    const result = await backfill();

    assert.strictEqual(result.days, 1);
    assert.strictEqual(result.confirmed, 2);

    const [document] = await stored();
    assert.strictEqual(document.day, day);
    assert.strictEqual(document.backfilled, true);
    assert.deepStrictEqual(document.events, { confirmed: 2 });
    assert.deepStrictEqual(document.lang, { fi: { confirmed: 1 }, sv: { confirmed: 1 } });
  });

  test('reconstructs nothing but confirmations', async () => {
    await db.collection('subscription').insertOne(createSubscription({ site_id: SITE, first_created: daysAgo(40) }));

    await backfill();

    // `created` would imply a permanent 100% conversion rate, and cancellations
    // and expiries are structurally unrecoverable.
    assert.deepStrictEqual((await stored())[0].events, { confirmed: 1 });
  });

  test('never touches a day that was collected live', async () => {
    const boundary = Statistics.day(daysAgo(10));
    await liveDay(boundary);

    await db.collection('subscription').insertMany([
      createSubscription({ site_id: SITE, first_created: daysAgo(40) }),
      // On and after the boundary, so out of the window.
      createSubscription({ site_id: SITE, first_created: daysAgo(10) }),
      createSubscription({ site_id: SITE, first_created: daysAgo(2) }),
    ]);

    const result = await backfill();

    assert.strictEqual(result.boundary, boundary);
    assert.strictEqual(result.confirmed, 1, 'only the subscription before the boundary');

    const live = (await stored()).find((document) => document.day === boundary);
    assert.strictEqual(live?.backfilled, undefined, 'the measured document is untouched');
    assert.strictEqual(live?.snapshot?.active, 7);
  });

  test('stops at today when nothing has been collected live yet', async () => {
    await db.collection('subscription').insertMany([
      createSubscription({ site_id: SITE, first_created: daysAgo(40) }),
      createSubscription({ site_id: SITE, first_created: new Date() }),
    ]);

    const result = await backfill();

    assert.strictEqual(result.boundary, Statistics.day());
    assert.strictEqual(result.confirmed, 1, "today's subscription is left for the live path");
  });

  test('is idempotent', async () => {
    await db.collection('subscription').insertMany([
      createSubscription({ site_id: SITE, first_created: daysAgo(40) }),
      createSubscription({ site_id: SITE, first_created: daysAgo(40) }),
    ]);

    await backfill();
    await backfill();
    await backfill();

    const documents = await stored();
    assert.strictEqual(documents.length, 1);
    assert.deepStrictEqual(documents[0].events, { confirmed: 2 }, 'absolute values, not increments');
  });

  test('leaves no stale language behind when survivors change', async () => {
    const subscription = db.collection('subscription');
    await subscription.insertMany([
      createSubscription({ site_id: SITE, first_created: daysAgo(40) }),
      createSubscription({ site_id: SITE, first_created: daysAgo(40), lang: 'sv' }),
    ]);

    await backfill();
    assert.deepStrictEqual((await stored())[0].lang, { fi: { confirmed: 1 }, sv: { confirmed: 1 } });

    await subscription.deleteMany({ lang: 'sv' });
    await backfill();

    assert.deepStrictEqual((await stored())[0].lang, { fi: { confirmed: 1 } });
    assert.deepStrictEqual((await stored())[0].events, { confirmed: 1 });
  });

  test('skips subscriptions that cannot be dated', async () => {
    await db.collection('subscription').insertMany([
      createSubscription({ site_id: SITE, first_created: daysAgo(40) }),
      // Predates first_created being written. `created` is not a fallback: it is
      // reset on renewal, so it would misdate every renewed subscription.
      createSubscription({ site_id: SITE, first_created: undefined }),
    ]);

    const result = await backfill();

    assert.strictEqual(result.skipped, 1);
    assert.strictEqual(result.confirmed, 1);
  });

  test('a dry run reports without writing', async () => {
    await db.collection('subscription').insertOne(createSubscription({ site_id: SITE, first_created: daysAgo(40) }));

    const result = await backfill(true);

    assert.strictEqual(result.days, 1);
    assert.strictEqual(result.confirmed, 1);
    assert.deepStrictEqual(await stored(), []);
  });

  test('ignores other sites', async () => {
    await db
      .collection('subscription')
      .insertOne(createSubscription({ site_id: 'other-site', first_created: daysAgo(40) }));

    const result = await backfill();

    assert.strictEqual(result.confirmed, 0);
    assert.deepStrictEqual(await stored(), []);
  });
});
