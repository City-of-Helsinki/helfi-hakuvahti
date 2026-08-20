import * as assert from 'node:assert';
import { after, before, beforeEach, describe, test } from 'node:test';
import { type Db, MongoClient } from 'mongodb';
import { Statistics } from '../../src/lib/statistics.ts';
import type { StatisticsCollectionType } from '../../src/types/statistics.ts';
import { SubscriptionStatus } from '../../src/types/subscription.ts';
import { build } from '../helper.ts';
import { createSubscription } from './utils.ts';

const SITE = 'test-stats';
const OTHER_SITE = 'test-stats-other';

describe('Statistics', () => {
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
    await db.collection('statistics').deleteMany({ site_id: SITE });
    await db.collection('subscription').deleteMany({ site_id: { $in: [SITE, OTHER_SITE] } });
  });

  /** Today's document for the test site, as the write path left it. */
  const today = async (): Promise<StatisticsCollectionType | null> =>
    (await db
      .collection('statistics')
      .findOne({ _id: `${SITE}:${Statistics.day()}` })) as StatisticsCollectionType | null;

  describe('day()', () => {
    test('buckets by Europe/Helsinki, not UTC', () => {
      // Summer, UTC+3: 21:00Z is already the next day in Helsinki.
      assert.strictEqual(Statistics.day(new Date('2026-07-01T20:59:00Z')), '2026-07-01');
      assert.strictEqual(Statistics.day(new Date('2026-07-01T21:00:00Z')), '2026-07-02');

      // Winter, UTC+2: the boundary moves an hour later.
      assert.strictEqual(Statistics.day(new Date('2026-01-01T21:59:00Z')), '2026-01-01');
      assert.strictEqual(Statistics.day(new Date('2026-01-01T22:00:00Z')), '2026-01-02');
    });

    test('formats as YYYY-MM-DD, zero padded', () => {
      assert.match(Statistics.day(new Date('2026-03-09T12:00:00Z')), /^2026-03-09$/);
    });
  });

  describe('record()', () => {
    test('creates the day document on the first event', async () => {
      await statistics.record(SITE, 'created', { lang: 'fi' });

      const document = await today();

      assert.ok(document);
      assert.strictEqual(document.site_id, SITE);
      assert.strictEqual(document.day, Statistics.day());
      assert.ok(document.created instanceof Date);
      assert.deepStrictEqual(document.events, { created: 1 });
      assert.deepStrictEqual(document.lang, { fi: { created: 1 } });
    });

    test('increments both the total and the language on later events', async () => {
      await statistics.record(SITE, 'created', { lang: 'fi' });
      await statistics.record(SITE, 'created', { lang: 'sv' });
      await statistics.record(SITE, 'confirmed', { lang: 'fi' });

      const document = await today();

      assert.deepStrictEqual(document?.events, { created: 2, confirmed: 1 });
      assert.deepStrictEqual(document?.lang, {
        fi: { created: 1, confirmed: 1 },
        sv: { created: 1 },
      });
    });

    test('keeps events.X equal to the sum over languages', async () => {
      await statistics.record(SITE, 'expired', { lang: 'fi', count: 7 });
      await statistics.record(SITE, 'expired', { lang: 'sv', count: 2 });
      await statistics.record(SITE, 'expired', { lang: 'en', count: 1 });

      const document = await today();
      const byLang = document?.lang ?? {};
      const summed = Object.values(byLang).reduce((total, counts) => total + (counts?.expired ?? 0), 0);

      assert.strictEqual(document?.events?.expired, 10);
      assert.strictEqual(summed, document?.events?.expired);
    });

    test('records a bulk count in one write', async () => {
      await statistics.record(SITE, 'expired_unconfirmed', { lang: 'fi', count: 12 });

      assert.deepStrictEqual((await today())?.events, { expired_unconfirmed: 12 });
    });

    test('does not write when there is nothing to count', async () => {
      await statistics.record(SITE, 'expired', { lang: 'fi', count: 0 });
      await statistics.record(SITE, 'expired', { lang: 'fi', count: -3 });

      assert.strictEqual(await today(), null);
    });

    test('refuses values that would be interpolated into a bad key path', async () => {
      // Reachable only past the type system, which is the case this guards: on
      // Cosmos DB the collection validator enforces nothing.
      await statistics.record(SITE, 'created; drop' as 'created', { lang: 'fi' });
      await statistics.record(SITE, 'created', { lang: 'de' as 'fi' });
      await statistics.record(SITE, 'created', { lang: undefined as unknown as 'fi' });

      assert.strictEqual(await today(), null);
    });

    test('retries once when two writes race to create the day', async () => {
      // Both find no document, both attempt the insert, one loses with E11000.
      // Retrying succeeds because by then the document exists.
      let attempts = 0;
      const racing = new Statistics({
        db: {
          collection: () => ({
            updateOne: async (...args: unknown[]) => {
              attempts += 1;

              if (attempts === 1) {
                throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
              }

              return db.collection('statistics').updateOne(...(args as [never, never, never]));
            },
          }),
        } as never,
      });

      await racing.record(SITE, 'created', { lang: 'fi' });

      assert.strictEqual(attempts, 2, 'the losing write is retried');
      assert.strictEqual((await today())?.events?.created, 1, 'and the counter is not lost');
    });

    test('gives up after one retry rather than looping', async () => {
      let attempts = 0;
      const alwaysRacing = new Statistics({
        db: {
          collection: () => ({
            updateOne: async () => {
              attempts += 1;
              throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
            },
          }),
        } as never,
      });

      await assert.doesNotReject(() => alwaysRacing.record(SITE, 'created', { lang: 'fi' }));
      assert.strictEqual(attempts, 2);
    });

    test('never throws when the database is unreachable', async () => {
      const broken = new Statistics({
        db: {
          collection: () => ({
            updateOne: () => Promise.reject(new Error('no connection')),
          }),
        } as unknown as Db,
      });

      await assert.doesNotReject(() => broken.record(SITE, 'created', { lang: 'fi' }));
    });
  });


  describe('countLive() and measure()', () => {
    const seed = (rows: Record<string, unknown>[]) =>
      db.collection('subscription').insertMany(rows.map((row) => createSubscription({ site_id: SITE, ...row })));

    test('counts active and unconfirmed subscriptions for one site', async () => {
      await seed([
        {},
        { lang: 'sv' },
        { status: SubscriptionStatus.INACTIVE },
        // Another site's rows must not be counted.
        { site_id: OTHER_SITE },
      ]);

      assert.deepStrictEqual(await statistics.countLive(SITE), { active: 2, unconfirmed: 1 });
    });

    test('counts zero for a site with no subscriptions', async () => {
      assert.deepStrictEqual(await statistics.countLive(SITE), { active: 0, unconfirmed: 0 });
    });

    test('measure() stores the counts and stamps the time', async () => {
      await seed([{}, { status: SubscriptionStatus.INACTIVE }]);

      await statistics.measure(SITE);

      const snapshot = (await today())?.snapshot;
      assert.strictEqual(snapshot?.active, 1);
      assert.strictEqual(snapshot?.unconfirmed, 1);
      assert.ok(snapshot?.at instanceof Date);
    });

    test('measure() re-measures, so the last write of the day wins', async () => {
      // Snapshots are measurements, so a second run reflects the database as it
      // then stands — and must not disturb the counters already recorded.
      const rows = await seed([{}, {}, { status: SubscriptionStatus.INACTIVE }]);
      await statistics.record(SITE, 'confirmed', { lang: 'fi' });
      await statistics.measure(SITE);

      await db.collection('subscription').deleteOne({ _id: rows.insertedIds[0] });
      await statistics.measure(SITE);

      const document = await today();
      assert.strictEqual(document?.snapshot?.active, 1, 'the later measurement wins');
      assert.strictEqual(document?.snapshot?.unconfirmed, 1);
      assert.deepStrictEqual(document?.events, { confirmed: 1 }, 'counters are untouched');
      assert.deepStrictEqual(document?.lang, { fi: { confirmed: 1 } });
    });

    test('measure() never throws when the count fails', async () => {
      // The cron measures every site in a loop; one unreachable database must not
      // abort the rest, and a lost measurement only costs one point in the series.
      const broken = new Statistics({
        db: { collection: () => ({ countDocuments: () => Promise.reject(new Error('unreachable')) }) } as never,
      });

      await assert.doesNotReject(() => broken.measure(SITE));
    });
  });

  describe('plugin', () => {
    test('decorates the server after mongodb is ready', async (t) => {
      const app = await build(t);

      assert.ok(app.statistics instanceof Statistics);
    });
  });
});
