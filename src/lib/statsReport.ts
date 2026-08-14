import {
  STAT_EVENTS,
  type StatCountsType,
  type StatisticsCollectionType,
  type StatsIntervalType,
  type StatsPeriodType,
} from '../types/statistics.ts';
import { SUBSCRIPTION_LANGUAGES } from '../types/subscription.ts';

// Turning stored day documents into the report /stats answers with. Pure: the
// current day is passed in, so day-boundary behaviour is testable.

/** Periods the default range covers, when no `from` is given. */
const DEFAULT_PERIODS: Record<StatsIntervalType, number> = { day: 31, month: 13 };

/** Longest series one response returns. The effective `range` shows what was used. */
const MAX_PERIODS: Record<StatsIntervalType, number> = { day: 366, month: 120 };

const toDay = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Parses YYYY-MM-DD as a calendar date, or null when it is not a real one. The
 * request schema pins the shape but not the calendar, so `2026-02-31` gets this
 * far looking valid.
 */
export function parseDay(day: string): Date | null {
  const date = new Date(`${day}T00:00:00Z`);

  return Number.isNaN(date.getTime()) || toDay(date) !== day ? null : date;
}

/** The period label a stored day belongs to. */
export const periodOf = (day: string, interval: StatsIntervalType): string =>
  interval === 'day' ? day : day.slice(0, 7);

/** First day of the period a day falls in. */
const startOfPeriod = (day: string, interval: StatsIntervalType): string =>
  interval === 'day' ? day : `${day.slice(0, 7)}-01`;

/** Last day of a period label. */
function endOfPeriod(period: string, interval: StatsIntervalType): string {
  if (interval === 'day') {
    return period;
  }

  const [year, month] = period.split('-').map(Number);

  // Day 0 of the following month is the last day of this one.
  return toDay(new Date(Date.UTC(year, month, 0)));
}

/** The start of the period `count` periods before the one `day` falls in. */
function periodsBack(day: string, interval: StatsIntervalType, count: number): string {
  const date = new Date(`${startOfPeriod(day, interval)}T00:00:00Z`);

  if (interval === 'day') {
    date.setUTCDate(date.getUTCDate() - count);
  } else {
    // The date sits on the 1st, so this cannot overflow into another month.
    date.setUTCMonth(date.getUTCMonth() - count);
  }

  return toDay(date);
}

export interface StatsRange {
  from: string;
  to: string;
  interval: StatsIntervalType;
}

/** Every period label in a range, ascending. Both labels sort chronologically. */
export function periodsIn({ from, to, interval }: StatsRange): string[] {
  // Normalised, because stepping a month from the 31st lands in the one after
  // next and drops a label.
  const cursor = parseDay(startOfPeriod(from, interval));
  if (!cursor) {
    return [];
  }

  const periods: string[] = [];
  while (toDay(cursor) <= to) {
    periods.push(periodOf(toDay(cursor), interval));

    if (interval === 'day') {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    } else {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }

  return periods;
}

/**
 * Resolves the range a request actually reads.
 *
 * Snapping both ends out to whole periods is what stops
 * `from=2026-07-15&interval=month` reporting half a July that reads as a 50%
 * collapse. For `interval=day` it is a no-op.
 */
export function resolveRange(
  interval: StatsIntervalType,
  requested: { from?: string; to?: string },
  today: string,
): StatsRange {
  // A `to` in the future would zero-fill periods that have not happened yet.
  const to = requested.to && requested.to < today ? requested.to : today;
  const from = requested.from ?? periodsBack(to, interval, DEFAULT_PERIODS[interval] - 1);
  const earliest = periodsBack(to, interval, MAX_PERIODS[interval] - 1);
  const latest = startOfPeriod(to, interval);
  const start = startOfPeriod(from, interval);

  return {
    interval,
    // Held between the cap and the last period, so the range is always a valid
    // one: a `from` past `to` is reachable whenever `to` was left to default.
    from: clamp(start, earliest, latest),
    to: endOfPeriod(periodOf(to, interval), interval),
  };
}

const clamp = (value: string, low: string, high: string): string => (value < low ? low : value > high ? high : value);

const zeroCounts = (): StatCountsType => Object.fromEntries(STAT_EVENTS.map((event) => [event, 0])) as StatCountsType;

/**
 * Sums the stored days into one row per period, zero-filling every period in the
 * range so charting code never has to reason about gaps.
 *
 * `documents` must be ordered by day ascending: `active_end` takes the last
 * snapshot it sees.
 */
export function buildPeriods(
  documents: StatisticsCollectionType[],
  range: StatsRange,
  today: string,
): StatsPeriodType[] {
  const byPeriod = new Map<string, StatisticsCollectionType[]>();

  for (const document of documents) {
    const period = periodOf(document.day, range.interval);
    const bucket = byPeriod.get(period);

    if (bucket) {
      bucket.push(document);
    } else {
      byPeriod.set(period, [document]);
    }
  }

  return periodsIn(range).map((period) => {
    const counts = zeroCounts();
    const confirmed_by_lang = Object.fromEntries(
      SUBSCRIPTION_LANGUAGES.map((lang) => [lang, 0]),
    ) as StatsPeriodType['confirmed_by_lang'];

    const days = byPeriod.get(period) ?? [];
    let active_end: number | null = null;
    let backfilled = false;

    for (const day of days) {
      for (const event of STAT_EVENTS) {
        counts[event] += day.events?.[event] ?? 0;
      }

      for (const lang of SUBSCRIPTION_LANGUAGES) {
        confirmed_by_lang[lang] += day.lang?.[lang]?.confirmed ?? 0;
      }

      if (day.snapshot) {
        active_end = day.snapshot.active;
      }

      if (day.backfilled) {
        backfilled = true;
      }
    }

    return {
      ...counts,
      period,
      confirmed_by_lang,
      // Null rather than zero when there is nothing to derive it from, so
      // "nothing was recorded" cannot read as "no churn happened". A period with
      // documents but no events is a genuine zero, because the cron leaves a
      // measurement behind even on a quiet day.
      net_change: backfilled || days.length === 0 ? null : counts.confirmed - counts.cancelled - counts.expired,
      active_end,
      backfilled,
      incomplete: endOfPeriod(period, range.interval) >= today,
    };
  });
}

interface CsvColumn {
  header: string;
  value: (period: StatsPeriodType) => string;
}

/** Nulls are an empty field, not the string "null". */
const nullable = (value: number | null): string => (value === null ? '' : String(value));

/**
 * Only `confirmed` is split by language: all six counters by three languages is
 * unreadable in a spreadsheet.
 */
const CSV_COLUMNS: CsvColumn[] = [
  { header: 'period', value: (period) => period.period },
  ...STAT_EVENTS.map((event) => ({ header: event, value: (period: StatsPeriodType) => String(period[event]) })),
  { header: 'net_change', value: (period) => nullable(period.net_change) },
  { header: 'active_end', value: (period) => nullable(period.active_end) },
  ...SUBSCRIPTION_LANGUAGES.map((lang) => ({
    header: `confirmed_${lang}`,
    value: (period: StatsPeriodType) => String(period.confirmed_by_lang[lang]),
  })),
  { header: 'backfilled', value: (period) => String(period.backfilled) },
  { header: 'incomplete', value: (period) => String(period.incomplete) },
];

/**
 * Renders the periods so they open in Excel without the import wizard:
 * semicolons, because Finnish-locale Excel splits on those, CRLF, and a byte
 * order mark so a future text column survives as UTF-8.
 *
 * No escaping: every value is a number, a boolean or a date label.
 */
export function toCsv(periods: StatsPeriodType[]): string {
  const rows = [
    CSV_COLUMNS.map((column) => column.header),
    ...periods.map((period) => CSV_COLUMNS.map((column) => column.value(period))),
  ];

  return `\ufeff${rows.map((row) => row.join(';')).join('\r\n')}\r\n`;
}
