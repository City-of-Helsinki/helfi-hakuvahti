import * as assert from 'node:assert';
import { describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { Statistics } from '../../src/lib/statistics.ts';
import type { StatisticsCollectionType, StatsResponseType } from '../../src/types/statistics.ts';
import { SubscriptionStatus } from '../../src/types/subscription.ts';
import { build, createSubscription, type TestContext } from '../helper.ts';

const SITE = 'rekry';
const AUTH = { Authorization: 'api-key test' };

/**
 * Fixture months are relative to the current month so the assertions do not
 * depend on the wall clock being before or after a hard-coded date.
 */
const monthsBack = (count: number): string => {
  const date = new Date(`${Statistics.day().slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - count);

  return date.toISOString().slice(0, 7);
};

const CURRENT_MONTH = monthsBack(0);
const FULL_MONTH = monthsBack(2);
const BACKFILL_MONTH = monthsBack(4);

const document = (day: string, overrides: Partial<StatisticsCollectionType> = {}): StatisticsCollectionType => ({
  _id: `${SITE}:${day}`,
  site_id: SITE,
  day,
  created: new Date(),
  ...overrides,
});

/**
 * Two days that sum to one full month, an older month, and a day inside the month
 * still running.
 */
const fixtures = (): StatisticsCollectionType[] => [
  document(`${BACKFILL_MONTH}-03`, {
    backfilled: true,
    events: { confirmed: 11 },
    lang: { fi: { confirmed: 10 }, en: { confirmed: 1 } },
  }),
  document(`${FULL_MONTH}-14`, {
    events: { created: 200, confirmed: 180, cancelled: 20, expired: 60, expired_unconfirmed: 25 },
    lang: {
      fi: { created: 188, confirmed: 168, cancelled: 19, expired: 57, expired_unconfirmed: 24 },
      sv: { created: 7, confirmed: 7, cancelled: 1, expired: 2, expired_unconfirmed: 1 },
      en: { created: 5, confirmed: 5, cancelled: 0, expired: 1, expired_unconfirmed: 0 },
    },
    snapshot: { at: new Date(), active: 4981, unconfirmed: 37 },
  }),
  document(`${FULL_MONTH}-15`, {
    events: { created: 255, confirmed: 222, cancelled: 18, expired: 71, expired_unconfirmed: 28 },
    lang: {
      fi: { created: 233, confirmed: 205, cancelled: 16, expired: 65, expired_unconfirmed: 24 },
      sv: { created: 12, confirmed: 10, cancelled: 2, expired: 4, expired_unconfirmed: 3 },
      en: { created: 10, confirmed: 7, cancelled: 0, expired: 2, expired_unconfirmed: 1 },
    },
    snapshot: { at: new Date(), active: 5010, unconfirmed: 40 },
  }),
  document(Statistics.day(), {
    events: { created: 4, confirmed: 3 },
    lang: { fi: { created: 4, confirmed: 3 } },
    snapshot: { at: new Date(), active: 5388, unconfirmed: 41 },
  }),
];

/** Seeds the fixtures and returns a ready server. */
async function seeded(t: TestContext): Promise<FastifyInstance> {
  const app = await build(t);
  const db = app.mongo.db;
  assert.ok(db);

  await db.collection('statistics').deleteMany({});
  await db.collection('subscription').deleteMany({});
  await db.collection<StatisticsCollectionType>('statistics').insertMany(fixtures());

  return app;
}

const asJson = (body: string): StatsResponseType => JSON.parse(body);

describe('/stats/:site_id', () => {
  describe('rejects bad requests', () => {
    test('403 without the api key', async (t) => {
      const app = await build(t);
      const res = await app.inject({ method: 'GET', url: `/stats/${SITE}` });

      assert.strictEqual(res.statusCode, 403);
    });

    test('400 for a site with no configuration', async (t) => {
      const app = await build(t);
      const res = await app.inject({ method: 'GET', url: '/stats/nonexistent', headers: AUTH });

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(JSON.parse(res.body).error, 'Invalid site_id provided.');
    });

    test('400 for a site id that is an inherited property name', async (t) => {
      const app = await build(t);

      for (const siteId of ['constructor', 'toString']) {
        const res = await app.inject({ method: 'GET', url: `/stats/${siteId}`, headers: AUTH });

        assert.strictEqual(res.statusCode, 400, siteId);
      }
    });

    test('400 for a malformed date', async (t) => {
      const app = await build(t);
      const res = await app.inject({ method: 'GET', url: `/stats/${SITE}?from=nope`, headers: AUTH });

      assert.strictEqual(res.statusCode, 400);
    });

    test('400 for a date the calendar does not have', async (t) => {
      const app = await build(t);
      const res = await app.inject({ method: 'GET', url: `/stats/${SITE}?from=2026-02-31`, headers: AUTH });

      assert.strictEqual(res.statusCode, 400);
      assert.deepStrictEqual(JSON.parse(res.body), { error: 'Invalid date.', field: 'from' });
    });

    test('400 when the range ends before it starts', async (t) => {
      const app = await build(t);
      const res = await app.inject({
        method: 'GET',
        url: `/stats/${SITE}?from=2026-06-01&to=2026-05-01`,
        headers: AUTH,
      });

      assert.strictEqual(res.statusCode, 400);
      assert.deepStrictEqual(JSON.parse(res.body), {
        error: 'Range end must not precede range start.',
        field: 'to',
      });
    });

    test('400 for an unsupported interval', async (t) => {
      const app = await build(t);
      const res = await app.inject({ method: 'GET', url: `/stats/${SITE}?interval=week`, headers: AUTH });

      assert.strictEqual(res.statusCode, 400);
    });
  });

  describe('answers with the figures', () => {
    test('rolls days up into months', async (t) => {
      const app = await seeded(t);
      const res = await app.inject({ method: 'GET', url: `/stats/${SITE}`, headers: AUTH });

      assert.strictEqual(res.statusCode, 200);
      const body = asJson(res.body);

      const month = body.periods.find((period) => period.period === FULL_MONTH);
      assert.ok(month, `${FULL_MONTH} should be in the default thirteen-month range`);
      assert.strictEqual(month.created, 455);
      assert.strictEqual(month.confirmed, 402);
      assert.strictEqual(month.cancelled, 38);
      assert.strictEqual(month.expired, 131);
      assert.strictEqual(month.expired_unconfirmed, 53);
      assert.strictEqual(month.net_change, 233);
      assert.strictEqual(month.active_end, 5010, 'the later snapshot of the two days');
      assert.strictEqual(month.incomplete, false);
      assert.deepStrictEqual(month.confirmed_by_lang, { fi: 373, sv: 17, en: 12 });
    });

    test('flags the month still in progress', async (t) => {
      const app = await seeded(t);
      const res = await app.inject({ method: 'GET', url: `/stats/${SITE}`, headers: AUTH });
      const body = asJson(res.body);

      const current = body.periods.at(-1);
      assert.strictEqual(current?.period, CURRENT_MONTH);
      assert.strictEqual(current.incomplete, true);
      assert.strictEqual(current.confirmed, 3);
    });

    test('sums a month that holds a single day', async (t) => {
      const app = await seeded(t);
      const res = await app.inject({ method: 'GET', url: `/stats/${SITE}`, headers: AUTH });
      const body = asJson(res.body);

      const month = body.periods.find((period) => period.period === BACKFILL_MONTH);
      assert.strictEqual(month?.confirmed, 11);
      assert.strictEqual(month.net_change, 11);
      assert.deepStrictEqual(month.confirmed_by_lang, { fi: 10, sv: 0, en: 1 });
    });

    test('reports the earliest recorded day', async (t) => {
      const app = await seeded(t);
      const res = await app.inject({ method: 'GET', url: `/stats/${SITE}`, headers: AUTH });

      assert.strictEqual(asJson(res.body).collecting_since, `${BACKFILL_MONTH}-03`);
    });

    test('zero-fills every period in the range', async (t) => {
      const app = await seeded(t);
      const res = await app.inject({ method: 'GET', url: `/stats/${SITE}`, headers: AUTH });
      const body = asJson(res.body);

      assert.strictEqual(body.periods.length, 13);

      // A month between the fixtures, so it is a real gap rather than an edge.
      const quiet = body.periods.find((period) => period.period === monthsBack(3));
      assert.ok(quiet);
      assert.strictEqual(quiet.created, 0);
      assert.strictEqual(quiet.confirmed, 0);
      assert.strictEqual(quiet.active_end, null);
      assert.strictEqual(quiet.net_change, null, 'nothing was recorded, so there is nothing to derive');
      assert.deepStrictEqual(quiet.confirmed_by_lang, { fi: 0, sv: 0, en: 0 });
    });

    test('returns raw days under interval=day', async (t) => {
      const app = await seeded(t);
      const res = await app.inject({
        method: 'GET',
        url: `/stats/${SITE}?interval=day&from=${FULL_MONTH}-14&to=${FULL_MONTH}-15`,
        headers: AUTH,
      });
      const body = asJson(res.body);

      assert.deepStrictEqual(body.range, { from: `${FULL_MONTH}-14`, to: `${FULL_MONTH}-15`, interval: 'day' });
      assert.deepStrictEqual(
        body.periods.map((period) => [period.period, period.created]),
        [
          [`${FULL_MONTH}-14`, 200],
          [`${FULL_MONTH}-15`, 255],
        ],
      );
    });

    test('echoes the effective range after snapping', async (t) => {
      const app = await seeded(t);
      const res = await app.inject({
        method: 'GET',
        url: `/stats/${SITE}?from=${FULL_MONTH}-15&to=${FULL_MONTH}-20`,
        headers: AUTH,
      });
      const body = asJson(res.body);

      assert.strictEqual(body.range.from, `${FULL_MONTH}-01`);
      assert.strictEqual(body.range.to.slice(0, 7), FULL_MONTH);
      assert.strictEqual(body.periods.length, 1);
      // Snapped out to the whole month, so the earlier day is included too.
      assert.strictEqual(body.periods[0].created, 455);
    });

    test('counts current subscriptions live, not from stored statistics', async (t) => {
      const app = await seeded(t);
      const subscription = app.mongo.db?.collection('subscription');

      await createSubscription(subscription, { site_id: SITE, status: SubscriptionStatus.ACTIVE });
      await createSubscription(subscription, { site_id: SITE, status: SubscriptionStatus.ACTIVE });
      await createSubscription(subscription, { site_id: SITE, status: SubscriptionStatus.INACTIVE });
      await createSubscription(subscription, { site_id: 'kymp', status: SubscriptionStatus.ACTIVE });

      const res = await app.inject({ method: 'GET', url: `/stats/${SITE}`, headers: AUTH });

      // The latest snapshot says 5388; `current` must disagree with it, because
      // it is measured now rather than read from a stored measurement.
      assert.deepStrictEqual(asJson(res.body).current, { active: 2, unconfirmed: 1 });
    });

    test('a configured site with no data is 200, not 404', async (t) => {
      const app = await seeded(t);
      const res = await app.inject({ method: 'GET', url: '/stats/kymp', headers: AUTH });
      const body = asJson(res.body);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(body.collecting_since, null);
      assert.deepStrictEqual(body.current, { active: 0, unconfirmed: 0 });
      assert.strictEqual(body.periods.length, 13);
      assert.ok(
        body.periods.every((period) => period.confirmed === 0 && period.active_end === null),
        'every period is zero-filled',
      );
    });

    test('does not leak another site whose id starts the same way', async (t) => {
      const app = await seeded(t);
      const db = app.mongo.db;
      assert.ok(db);

      // `rekry2` is not configured, but its documents must not be read as
      // rekry's by the _id range scan either.
      await db.collection<StatisticsCollectionType>('statistics').insertOne({
        _id: `rekry2:${FULL_MONTH}-14`,
        site_id: 'rekry2',
        day: `${FULL_MONTH}-14`,
        created: new Date(),
        events: { confirmed: 9999 },
      });

      const res = await app.inject({ method: 'GET', url: `/stats/${SITE}`, headers: AUTH });
      const month = asJson(res.body).periods.find((period) => period.period === FULL_MONTH);

      assert.strictEqual(month?.confirmed, 402, "rekry2's document must not be counted");
    });
  });

});
