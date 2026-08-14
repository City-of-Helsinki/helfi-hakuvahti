import * as assert from 'node:assert';
import { after, before, beforeEach, describe, test } from 'node:test';
import { type Db, MongoClient } from 'mongodb';
import { Statistics } from '../../src/lib/statistics.ts';
import type { StatisticsCollectionType } from '../../src/types/statistics.ts';
import { build } from '../helper.ts';

const SITE = 'test-stats';

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

    test('never throws when the database is unreachable', async () => {
      const broken = new Statistics({
        db: {
          collection: () => ({
            updateOne: () => Promise.reject(new Error('no connection')),
          }),
        } as unknown as Db,
      });

      await assert.doesNotReject(() => broken.record(SITE, 'created', { lang: 'fi' }));
      await assert.doesNotReject(() => broken.recordSnapshot(SITE, { active: 1, unconfirmed: 0 }));
    });
  });

  describe('recordSnapshot()', () => {
    test('stores the measured counts and stamps the time', async () => {
      await statistics.recordSnapshot(SITE, { active: 4981, unconfirmed: 37 });

      const document = await today();

      assert.strictEqual(document?.snapshot?.active, 4981);
      assert.strictEqual(document?.snapshot?.unconfirmed, 37);
      assert.ok(document?.snapshot?.at instanceof Date);
    });

    test('last write of the day wins, and leaves counters alone', async () => {
      await statistics.record(SITE, 'confirmed', { lang: 'fi' });
      await statistics.recordSnapshot(SITE, { active: 10, unconfirmed: 1 });
      await statistics.recordSnapshot(SITE, { active: 12, unconfirmed: 0 });

      const document = await today();

      assert.strictEqual(document?.snapshot?.active, 12);
      assert.strictEqual(document?.snapshot?.unconfirmed, 0);
      assert.deepStrictEqual(document?.events, { confirmed: 1 });
    });
  });

  describe('plugin', () => {
    test('decorates the server after mongodb is ready', async (t) => {
      const app = await build(t);

      assert.ok(app.statistics instanceof Statistics);
    });
  });
});
