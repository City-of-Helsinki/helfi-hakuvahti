import * as assert from 'node:assert';
import { after, before, beforeEach, describe, test } from 'node:test';
import { type Db, MongoClient } from 'mongodb';
import { Statistics } from '../../src/lib/statistics.ts';
import { expireSubscriptions } from '../../src/lib/subscriptionExpiry.ts';
import type { StatisticsCollectionType } from '../../src/types/statistics.ts';
import { SubscriptionStatus } from '../../src/types/subscription.ts';
import { createSubscription } from './utils.ts';

const SITE = 'test-site';

/** Older than any maxAge the tests use. */
const longAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);

describe('expireSubscriptions', () => {
  assert.ok(process.env.MONGODB);
  const mongo = new MongoClient(process.env.MONGODB);

  let db: Db;
  let statistics: Statistics;

  before(async () => {
    await mongo.connect();
    db = mongo.db();
    statistics = new Statistics({ db });
  });

  after(async () => {
    await mongo.close();
  });

  beforeEach(async () => {
    await db.collection('subscription').deleteMany({});
    await db.collection('statistics').deleteMany({ site_id: SITE });
  });

  const counters = async (): Promise<StatisticsCollectionType | null> =>
    (await db
      .collection('statistics')
      .findOne({ _id: `${SITE}:${Statistics.day()}` })) as StatisticsCollectionType | null;

  const expire = (status: SubscriptionStatus, isDryRun = false) =>
    expireSubscriptions(db, statistics, { siteId: SITE, status, olderThanDays: 90, isDryRun });

  test('counts expired active subscriptions per language', async () => {
    await db.collection('subscription').insertMany([
      createSubscription({ created: longAgo }),
      createSubscription({ created: longAgo }),
      createSubscription({ created: longAgo, lang: 'sv' }),
      createSubscription({ created: longAgo, lang: 'en' }),
    ]);

    const deleted = await expire(SubscriptionStatus.ACTIVE);

    assert.strictEqual(deleted, 4);
    assert.strictEqual(await db.collection('subscription').countDocuments({}), 0);

    const stats = await counters();
    assert.strictEqual(stats?.events?.expired, 4);
    assert.deepStrictEqual(stats?.lang, {
      fi: { expired: 2 },
      sv: { expired: 1 },
      en: { expired: 1 },
    });
  });

  test('counts abandoned signups separately from expired ones', async () => {
    await db.collection('subscription').insertMany([
      createSubscription({ created: longAgo }),
      createSubscription({ created: longAgo, status: SubscriptionStatus.INACTIVE }),
      createSubscription({ created: longAgo, status: SubscriptionStatus.INACTIVE }),
    ]);

    await expire(SubscriptionStatus.INACTIVE);
    await expire(SubscriptionStatus.ACTIVE);

    const stats = await counters();
    assert.strictEqual(stats?.events?.expired_unconfirmed, 2);
    assert.strictEqual(stats?.events?.expired, 1);
  });

  test('leaves subscriptions younger than the age limit alone', async () => {
    await db.collection('subscription').insertMany([
      createSubscription({ created: new Date() }),
      createSubscription({ created: longAgo }),
    ]);

    const deleted = await expire(SubscriptionStatus.ACTIVE);

    assert.strictEqual(deleted, 1);
    assert.strictEqual(await db.collection('subscription').countDocuments({}), 1);
    assert.strictEqual((await counters())?.events?.expired, 1);
  });

  test('does not touch another site', async () => {
    await db.collection('subscription').insertOne(createSubscription({ created: longAgo, site_id: 'other-site' }));

    const deleted = await expire(SubscriptionStatus.ACTIVE);

    assert.strictEqual(deleted, 0);
    assert.strictEqual(await db.collection('subscription').countDocuments({}), 1);
  });

  test('writes no counters when nothing was deleted', async () => {
    const deleted = await expire(SubscriptionStatus.ACTIVE);

    assert.strictEqual(deleted, 0);
    assert.strictEqual(await counters(), null);
  });

  test('a dry run neither deletes nor counts', async () => {
    await db.collection('subscription').insertOne(createSubscription({ created: longAgo }));

    const deleted = await expire(SubscriptionStatus.ACTIVE, true);

    assert.strictEqual(deleted, 0);
    assert.strictEqual(await db.collection('subscription').countDocuments({}), 1);
    assert.strictEqual(await counters(), null);
  });

  test('still deletes when the language grouping is unavailable', async () => {
    await db.collection('subscription').insertOne(createSubscription({ created: longAgo }));

    // A server that does not support the aggregation must not stop the cleanup.
    const withoutAggregate = {
      collection: () => ({
        aggregate: () => ({ toArray: () => Promise.reject(new Error('$group unsupported')) }),
        deleteMany: (filter: object) => db.collection('subscription').deleteMany(filter),
        countDocuments: (filter: object) => db.collection('subscription').countDocuments(filter),
      }),
    } as unknown as Db;

    const deleted = await expireSubscriptions(withoutAggregate, statistics, {
      siteId: SITE,
      status: SubscriptionStatus.ACTIVE,
      olderThanDays: 90,
      isDryRun: false,
    });

    assert.strictEqual(deleted, 1, 'the expired subscription is gone');
    assert.strictEqual(await db.collection('subscription').countDocuments({}), 0);
    assert.strictEqual(await counters(), null, 'the counters are lost, which is the acceptable half');
  });

  test('a second run over the same rows does not double count', async () => {
    await db.collection('subscription').insertMany([
      createSubscription({ created: longAgo }),
      createSubscription({ created: longAgo }),
    ]);

    await expire(SubscriptionStatus.ACTIVE);
    await expire(SubscriptionStatus.ACTIVE);

    assert.strictEqual((await counters())?.events?.expired, 2);
  });
});
