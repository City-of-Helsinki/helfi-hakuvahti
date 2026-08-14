import type { Db } from 'mongodb';
import type { StatisticsCollectionType } from '../types/statistics.ts';
import { SUBSCRIPTION_LANGUAGES, type SubscriptionCollectionLanguageType } from '../types/subscription.ts';
import { Statistics } from './statistics.ts';

export interface BackfillOptions {
  siteId: string;
  /** Report what would be written, write nothing. */
  isDryRun: boolean;
}

export interface BackfillResult {
  /** Days written, or that a real run would write. */
  days: number;
  /** Confirmations placed on those days. */
  confirmed: number;
  /** Subscriptions that could not be dated, so were left out. */
  skipped: number;
  /** Exclusive upper bound: nothing on or after this day is touched. */
  boundary: string;
}

/**
 * Reconstructs historical `confirmed` counters from surviving subscriptions, for
 * the days before live collection began.
 *
 * Only `confirmed`, and it undercounts: anyone who unsubscribed or expired is
 * already deleted. `created` is deliberately not reconstructed — unconfirmed rows
 * are deleted within days, so every survivor is confirmed, and backfilling
 * `created` from them would show a permanent 100% conversion rate.
 *
 * Days are bucketed with the same Statistics.day() the live path uses, so the two
 * cannot disagree about where a timezone boundary falls.
 */
export async function backfillStatistics(db: Db, { siteId, isDryRun }: BackfillOptions): Promise<BackfillResult> {
  const statistics = db.collection<StatisticsCollectionType>('statistics');

  // Live collection begins at the earliest day no backfill wrote; from there on
  // the counters are measured and must not be overwritten. Deriving the bound
  // from non-backfilled documents is what keeps this re-runnable — its own output
  // would otherwise move the bound backwards on every run.
  const live = await statistics
    .find({ _id: { $gte: `${siteId}:`, $lt: `${siteId};` }, backfilled: { $ne: true } })
    .sort({ _id: 1 })
    .limit(1)
    .next();

  const boundary = live?.day ?? Statistics.day();

  // Projected rather than cast, so the type says what the projection returns.
  const subscriptions = await db
    .collection('subscription')
    .find({ site_id: siteId })
    .project<{ first_created?: Date; lang?: string }>({ first_created: 1, lang: 1 })
    .toArray();

  let skipped = 0;
  const byDay = new Map<string, Map<SubscriptionCollectionLanguageType, number>>();

  for (const { first_created, lang } of subscriptions) {
    // `created` is reset on renewal, so it is not a usable fallback: it would
    // misdate every subscription that has ever been renewed.
    if (!first_created || !lang || !SUBSCRIPTION_LANGUAGES.includes(lang as SubscriptionCollectionLanguageType)) {
      skipped++;
      continue;
    }

    const day = Statistics.day(new Date(first_created));
    if (day >= boundary) {
      continue;
    }

    const language = lang as SubscriptionCollectionLanguageType;
    const languages = byDay.get(day) ?? new Map();
    languages.set(language, (languages.get(language) ?? 0) + 1);
    byDay.set(day, languages);
  }

  let confirmed = 0;

  for (const [day, languages] of byDay) {
    const total = [...languages.values()].reduce((sum, count) => sum + count, 0);
    confirmed += total;

    if (isDryRun) {
      continue;
    }

    await statistics.updateOne(
      { _id: `${siteId}:${day}` },
      {
        // Absolute values rather than $inc so a second run is a no-op, and whole
        // subtrees rather than dotted paths so a language that lost its survivors
        // leaves no stale count. Safe only because the day predates live
        // collection, where no measured counter exists to destroy.
        $set: {
          site_id: siteId,
          day,
          backfilled: true,
          events: { confirmed: total },
          lang: Object.fromEntries([...languages].map(([language, count]) => [language, { confirmed: count }])),
        },
        $setOnInsert: { created: new Date() },
      },
      { upsert: true },
    );
  }

  return { days: byDay.size, confirmed, skipped, boundary };
}
