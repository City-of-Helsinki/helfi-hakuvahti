import * as assert from 'node:assert';
import { describe, test } from 'node:test';
import { buildPeriods, parseDay, periodOf, periodsIn, resolveRange, toCsv } from '../../src/lib/statsReport.ts';
import type { StatisticsCollectionType } from '../../src/types/statistics.ts';

/** A fixed "today" so day-boundary behaviour is deterministic. */
const TODAY = '2026-08-13';

const document = (day: string, overrides: Partial<StatisticsCollectionType> = {}): StatisticsCollectionType => ({
  _id: `rekry:${day}`,
  site_id: 'rekry',
  day,
  created: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

describe('statsReport', () => {
  describe('parseDay', () => {
    test('accepts real dates', () => {
      assert.ok(parseDay('2026-08-13'));
      assert.ok(parseDay('2028-02-29'), 'a leap day is a real date');
    });

    test('rejects dates the calendar does not have', () => {
      assert.strictEqual(parseDay('2026-02-31'), null);
      assert.strictEqual(parseDay('2026-13-01'), null);
      assert.strictEqual(parseDay('2027-02-29'), null, '2027 is not a leap year');
      assert.strictEqual(parseDay('not-a-date'), null);
    });
  });

  describe('periodOf', () => {
    test('is the day itself, or its month', () => {
      assert.strictEqual(periodOf('2026-10-14', 'day'), '2026-10-14');
      assert.strictEqual(periodOf('2026-10-14', 'month'), '2026-10');
    });
  });

  describe('resolveRange', () => {
    test('defaults to thirteen months, snapped to whole months', () => {
      const range = resolveRange('month', {}, TODAY);

      assert.deepStrictEqual(range, { interval: 'month', from: '2025-08-01', to: '2026-08-31' });
      assert.strictEqual(periodsIn(range).length, 13);
    });

    test('defaults to thirty-one days', () => {
      const range = resolveRange('day', {}, TODAY);

      assert.deepStrictEqual(range, { interval: 'day', from: '2026-07-14', to: '2026-08-13' });
      assert.strictEqual(periodsIn(range).length, 31);
    });

    test('snaps a partial month out to the whole month', () => {
      // Without this, July would report half a month and read as a collapse.
      const range = resolveRange('month', { from: '2026-07-15', to: '2026-07-20' }, TODAY);

      assert.deepStrictEqual(range, { interval: 'month', from: '2026-07-01', to: '2026-07-31' });
    });

    test('snapping is a no-op for days', () => {
      const range = resolveRange('day', { from: '2026-07-15', to: '2026-07-20' }, TODAY);

      assert.deepStrictEqual(range, { interval: 'day', from: '2026-07-15', to: '2026-07-20' });
    });

    test('clamps a future `to` back to today', () => {
      assert.strictEqual(resolveRange('day', { from: '2026-08-01', to: '2030-01-01' }, TODAY).to, TODAY);
      assert.strictEqual(resolveRange('month', { from: '2026-08-01', to: '2030-01-01' }, TODAY).to, '2026-08-31');
    });

    test('finds the last day of any month', () => {
      // All in the past, or the clamp to today would answer instead.
      assert.strictEqual(resolveRange('month', { to: '2026-02-10' }, TODAY).to, '2026-02-28');
      assert.strictEqual(resolveRange('month', { to: '2024-02-10' }, TODAY).to, '2024-02-29', 'a leap February');
      assert.strictEqual(resolveRange('month', { to: '2026-04-10' }, TODAY).to, '2026-04-30');
    });

    test('holds `from` inside the range when it is in the future', () => {
      // `to` defaults to today, so the route's to-before-from check cannot fire.
      const days = resolveRange('day', { from: '2026-08-20' }, TODAY);
      assert.deepStrictEqual(days, { interval: 'day', from: TODAY, to: TODAY });
      assert.strictEqual(periodsIn(days).length, 1);

      const months = resolveRange('month', { from: '2030-01-01' }, TODAY);
      assert.deepStrictEqual(months, { interval: 'month', from: '2026-08-01', to: '2026-08-31' });
    });

    test('caps an unbounded range and reports the window it used', () => {
      const days = resolveRange('day', { from: '1900-01-01' }, TODAY);
      assert.strictEqual(periodsIn(days).length, 366);
      assert.strictEqual(days.to, TODAY);

      const months = resolveRange('month', { from: '1900-01-01' }, TODAY);
      assert.strictEqual(periodsIn(months).length, 120);
    });
  });

  describe('periodsIn', () => {
    test('spans year boundaries in order', () => {
      assert.deepStrictEqual(periodsIn({ interval: 'month', from: '2026-11-01', to: '2027-02-28' }), [
        '2026-11',
        '2026-12',
        '2027-01',
        '2027-02',
      ]);
    });

    test('drops no month when the range starts on a 31st', () => {
      // Stepping a month from the 31st lands in the one after next.
      assert.deepStrictEqual(periodsIn({ interval: 'month', from: '2026-01-31', to: '2026-04-30' }), [
        '2026-01',
        '2026-02',
        '2026-03',
        '2026-04',
      ]);
    });

    test('enumerates every day, February included', () => {
      assert.deepStrictEqual(periodsIn({ interval: 'day', from: '2026-02-26', to: '2026-03-01' }), [
        '2026-02-26',
        '2026-02-27',
        '2026-02-28',
        '2026-03-01',
      ]);
    });
  });

  describe('buildPeriods', () => {
    // Two days whose counters sum to one month, with a language split that adds
    // up exactly, so the rollup and the partition can both be checked.
    const fullMonth = [
      document('2026-06-14', {
        events: { created: 200, confirmed: 180, cancelled: 20, expired: 60, expired_unconfirmed: 25 },
        lang: {
          fi: { created: 188, confirmed: 168, cancelled: 19, expired: 57, expired_unconfirmed: 24 },
          sv: { created: 7, confirmed: 7, cancelled: 1, expired: 2, expired_unconfirmed: 1 },
          en: { created: 5, confirmed: 5, cancelled: 0, expired: 1, expired_unconfirmed: 0 },
        },
        snapshot: { at: new Date('2026-06-14T04:00:00Z'), active: 4981, unconfirmed: 37 },
      }),
      document('2026-06-15', {
        events: { created: 255, confirmed: 222, cancelled: 18, expired: 71, expired_unconfirmed: 28 },
        lang: {
          fi: { created: 233, confirmed: 205, cancelled: 16, expired: 65, expired_unconfirmed: 24 },
          sv: { created: 12, confirmed: 10, cancelled: 2, expired: 4, expired_unconfirmed: 3 },
          en: { created: 10, confirmed: 7, cancelled: 0, expired: 2, expired_unconfirmed: 1 },
        },
        snapshot: { at: new Date('2026-06-15T04:00:00Z'), active: 5010, unconfirmed: 40 },
      }),
    ];

    test('sums the days of a month', () => {
      const [june] = buildPeriods(fullMonth, { interval: 'month', from: '2026-06-01', to: '2026-06-30' }, TODAY);

      assert.strictEqual(june.period, '2026-06');
      assert.strictEqual(june.created, 455);
      assert.strictEqual(june.confirmed, 402);
      assert.strictEqual(june.cancelled, 38);
      assert.strictEqual(june.expired, 131);
      assert.strictEqual(june.expired_unconfirmed, 53);
      assert.strictEqual(june.cancelled_unconfirmed, 0);
    });

    test('derives net_change and takes active_end from the last snapshot', () => {
      const [june] = buildPeriods(fullMonth, { interval: 'month', from: '2026-06-01', to: '2026-06-30' }, TODAY);

      assert.strictEqual(june.net_change, 233, '402 - 38 - 131');
      assert.strictEqual(june.active_end, 5010, 'the later of the two snapshots');
      assert.strictEqual(june.incomplete, false);
      assert.strictEqual(june.backfilled, false);
    });

    test('splits confirmations by language, summing to the total', () => {
      const [june] = buildPeriods(fullMonth, { interval: 'month', from: '2026-06-01', to: '2026-06-30' }, TODAY);

      assert.deepStrictEqual(june.confirmed_by_lang, { fi: 373, sv: 17, en: 12 });

      const summed = Object.values(june.confirmed_by_lang).reduce((total, count) => total + count, 0);
      assert.strictEqual(summed, june.confirmed);
    });

    test('keeps days separate under interval=day', () => {
      const days = buildPeriods(fullMonth, { interval: 'day', from: '2026-06-14', to: '2026-06-15' }, TODAY);

      assert.deepStrictEqual(
        days.map((day) => [day.period, day.created, day.active_end]),
        [
          ['2026-06-14', 200, 4981],
          ['2026-06-15', 255, 5010],
        ],
      );
    });

    test('zero-fills periods that have no document', () => {
      const periods = buildPeriods([], { interval: 'month', from: '2026-04-01', to: '2026-06-30' }, TODAY);

      assert.strictEqual(periods.length, 3);
      assert.deepStrictEqual(
        periods.map((period) => period.period),
        ['2026-04', '2026-05', '2026-06'],
      );

      for (const period of periods) {
        assert.strictEqual(period.created, 0);
        assert.strictEqual(period.confirmed, 0);
        assert.deepStrictEqual(period.confirmed_by_lang, { fi: 0, sv: 0, en: 0 });
        // Nothing was recorded for these periods at all, so there is nothing to
        // derive a net change from. Zero would read as "no churn happened".
        assert.strictEqual(period.net_change, null);
        assert.strictEqual(period.active_end, null);
      }
    });

    test('a monitored but quiet period is a real zero, not a null', () => {
      // The cron writes a snapshot every day, so a quiet month still has rows —
      // which is what separates "nothing happened" from "nothing was recorded".
      const quiet = [document('2026-06-15', { snapshot: { at: new Date(), active: 812, unconfirmed: 4 } })];

      const [june] = buildPeriods(quiet, { interval: 'month', from: '2026-06-01', to: '2026-06-30' }, TODAY);

      assert.strictEqual(june.confirmed, 0);
      assert.strictEqual(june.net_change, 0);
      assert.strictEqual(june.active_end, 812);
    });

    test('withholds net_change for backfilled periods', () => {
      const backfilled = [
        document('2026-05-03', {
          backfilled: true,
          events: { confirmed: 11 },
          lang: { fi: { confirmed: 10 }, en: { confirmed: 1 } },
        }),
      ];

      const [may] = buildPeriods(backfilled, { interval: 'month', from: '2026-05-01', to: '2026-05-31' }, TODAY);

      assert.strictEqual(may.confirmed, 11);
      assert.strictEqual(may.backfilled, true);
      assert.strictEqual(may.net_change, null, 'the inputs are known-incomplete');
      assert.deepStrictEqual(may.confirmed_by_lang, { fi: 10, sv: 0, en: 1 });
    });

    test('marks a period that has not ended as incomplete', () => {
      const months = buildPeriods([], { interval: 'month', from: '2026-07-01', to: '2026-08-31' }, TODAY);

      assert.strictEqual(months[0].incomplete, false, 'July has ended');
      assert.strictEqual(months[1].incomplete, true, 'August is still running');
    });

    test('marks today, and only today, as incomplete under interval=day', () => {
      const days = buildPeriods([], { interval: 'day', from: '2026-08-11', to: TODAY }, TODAY);

      assert.deepStrictEqual(
        days.map((day) => day.incomplete),
        [false, false, true],
      );
    });
  });

  describe('toCsv', () => {
    const periods = buildPeriods(
      [
        document('2026-06-14', {
          events: { created: 12, confirmed: 10, cancelled: 1 },
          lang: { fi: { created: 11, confirmed: 9, cancelled: 1 }, sv: { created: 1, confirmed: 1 } },
          snapshot: { at: new Date('2026-06-14T04:00:00Z'), active: 500, unconfirmed: 3 },
        }),
      ],
      { interval: 'month', from: '2026-06-01', to: '2026-06-30' },
      TODAY,
    );

    test('opens in a Finnish-locale spreadsheet', () => {
      const csv = toCsv(periods);

      assert.ok(csv.startsWith('﻿'), 'starts with a byte order mark');
      assert.ok(csv.endsWith('\r\n'), 'CRLF line endings');
      assert.ok(csv.includes(';'), 'semicolon delimited');
      assert.ok(!csv.includes('\n\n'));
    });

    test('has one header row and one row per period', () => {
      const [header, row, ...rest] = toCsv(periods).slice(1).split('\r\n');

      assert.strictEqual(
        header,
        'period;created;confirmed;cancelled;cancelled_unconfirmed;expired;expired_unconfirmed;' +
          'net_change;active_end;confirmed_fi;confirmed_sv;confirmed_en;backfilled;incomplete',
      );
      assert.strictEqual(row, '2026-06;12;10;1;0;0;0;9;500;9;1;0;false;false');
      assert.deepStrictEqual(rest, [''], 'trailing newline only');
    });

    test('renders a null as an empty field, not the word null', () => {
      const backfilled = buildPeriods(
        [document('2026-05-03', { backfilled: true, events: { confirmed: 11 } })],
        { interval: 'month', from: '2026-05-01', to: '2026-05-31' },
        TODAY,
      );

      const row = toCsv(backfilled).slice(1).split('\r\n')[1];

      assert.strictEqual(row, '2026-05;0;11;0;0;0;0;;;0;0;0;true;false');
      assert.ok(!row.includes('null'));
    });
  });
});
