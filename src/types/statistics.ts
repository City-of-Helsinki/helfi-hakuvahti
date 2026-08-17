import { type Static, type TSchema, Type } from '@sinclair/typebox';
import { SUBSCRIPTION_LANGUAGES, type SubscriptionCollectionLanguageType } from './subscription.ts';

/**
 * One entry per subscription language. Built from the array because `Type.Record`
 * loses the literal keys when its union was mapped from one, degrading to `{}`.
 */
const ByLanguage = <T extends TSchema>(value: T) =>
  Type.Object(
    Object.fromEntries(SUBSCRIPTION_LANGUAGES.map((lang) => [lang, value])) as Record<
      SubscriptionCollectionLanguageType,
      T
    >,
  );

/** Closed, because event names end up in `$inc` key paths. */
export const STAT_EVENTS = [
  'created',
  'confirmed',
  'cancelled',
  'cancelled_unconfirmed',
  'expired',
  'expired_unconfirmed',
] as const;
export type StatEventType = (typeof STAT_EVENTS)[number];

/**
 * Every counter, zero-filled. The single source of truth for counter names:
 * stored documents hold a Partial of this, responses the full set.
 */
export const StatCounts = Type.Object({
  created: Type.Number(),
  confirmed: Type.Number(),
  cancelled: Type.Number(),
  cancelled_unconfirmed: Type.Number(),
  expired: Type.Number(),
  expired_unconfirmed: Type.Number(),
});
export type StatCountsType = Static<typeof StatCounts>;

/** Live counts measured once per cron run, not a sum of events. */
export const StatSnapshot = Type.Object({
  at: Type.Date(),
  active: Type.Number(),
  unconfirmed: Type.Number(),
});
export type StatSnapshotType = Static<typeof StatSnapshot>;

/** What recordSnapshot() is given; `at` is stamped by the writer. */
export type StatSnapshotInput = Omit<StatSnapshotType, 'at'>;

/** One stored day, keyed `${site_id}:${day}`. Sparse: absent means zero. */
export const StatisticsCollection = Type.Object({
  _id: Type.String(),
  site_id: Type.String(),
  /** YYYY-MM-DD, Europe/Helsinki. See Statistics.day(). */
  day: Type.String(),
  created: Type.Date(),
  /**
   * Written and read only by hav:backfill-statistics, to tell its own output from
   * measured days so re-runs stay idempotent. Not part of the API.
   */
  backfilled: Type.Optional(Type.Boolean()),
  events: Type.Optional(Type.Partial(StatCounts)),
  lang: Type.Optional(Type.Partial(ByLanguage(Type.Partial(StatCounts)))),
  snapshot: Type.Optional(StatSnapshot),
});
export type StatisticsCollectionType = Static<typeof StatisticsCollection>;

// --- GET /stats/:site_id ---

const IsoDay = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });

/** The grain the store holds, and the grain a monthly report needs. */
export const StatsInterval = Type.Union([Type.Literal('day'), Type.Literal('month')]);
export type StatsIntervalType = Static<typeof StatsInterval>;

export const StatsQuery = Type.Object({
  interval: Type.Optional(StatsInterval),
  from: Type.Optional(IsoDay),
  to: Type.Optional(IsoDay),
});
export type StatsQueryType = Static<typeof StatsQuery>;

export const StatsPeriod = Type.Composite([
  StatCounts,
  Type.Object({
    period: Type.String(),
    confirmed_by_lang: ByLanguage(Type.Number()),
    /** Null when nothing was recorded for the period. */
    net_change: Type.Union([Type.Number(), Type.Null()]),
    active_end: Type.Union([Type.Number(), Type.Null()]),
    /** The period has not ended, so its counters are still growing. */
    incomplete: Type.Boolean(),
  }),
]);
export type StatsPeriodType = Static<typeof StatsPeriod>;

export const StatsResponse = Type.Object({
  site_id: Type.String(),
  generated_at: Type.String(),
  /** Earliest recorded day; anything before it reads zero for want of data. */
  collecting_since: Type.Union([Type.String(), Type.Null()]),
  /** The effective range, after defaults, clamping and snapping. */
  range: Type.Object({ from: IsoDay, to: IsoDay, interval: StatsInterval }),
  /** Counted live off `subscription`, so it is right even if the cron has not run. */
  current: Type.Object({
    active: Type.Number(),
    unconfirmed: Type.Number(),
  }),
  periods: Type.Array(StatsPeriod),
});
export type StatsResponseType = Static<typeof StatsResponse>;
