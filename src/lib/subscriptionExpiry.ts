import * as Sentry from '@sentry/node';
import type { Collection, Db } from 'mongodb';
import { type SubscriptionCollectionLanguageType, SubscriptionStatus } from '../types/subscription.ts';
import type { Statistics } from './statistics.ts';

export interface ExpireSubscriptionsOptions {
  siteId: string;
  /** ACTIVE expires against maxAge, INACTIVE against unconfirmedMaxAge. */
  status: SubscriptionStatus;
  olderThanDays: number;
  /** Report what would be deleted, write nothing. */
  isDryRun: boolean;
}

interface ExpiryFilter {
  status: SubscriptionStatus;
  site_id: string;
  created: { $lt: Date };
}

/**
 * Deletes a site's subscriptions past their age limit and records them as
 * `expired` / `expired_unconfirmed`.
 *
 * Recording happens here because this is the only moment an expiry is
 * distinguishable from a user-initiated cancellation; afterwards both are an
 * absent document. Note that age is measured from `created`, which is reset on
 * renewal, against the site's *current* maxAge — so lowering maxAge retroactively
 * expires live subscriptions on the next run.
 *
 * @returns the number of subscriptions deleted.
 */
export async function expireSubscriptions(
  db: Db,
  statistics: Statistics,
  { siteId, status, olderThanDays, isDryRun }: ExpireSubscriptionsOptions,
): Promise<number> {
  const collection = db.collection('subscription');
  const filter: ExpiryFilter = {
    status,
    site_id: siteId,
    created: { $lt: new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000) },
  };

  try {
    if (isDryRun) {
      const total = await collection.countDocuments(filter);
      console.log(`[DRY RUN] Would delete ${total} subscription(s) with status ${status} for site ${siteId}`);

      return 0;
    }

    // Taken before the rows are gone, because deleteMany only reports a total.
    const byLang = await groupByLanguage(collection, filter, siteId);
    const { deletedCount } = await collection.deleteMany(filter);

    // Nothing deleted, nothing to count. This is also what stops two overlapping
    // cron runs double counting: the second run's grouping can still see rows the
    // first is deleting, but its deleteMany removes none of them.
    if (deletedCount === 0) {
      return 0;
    }

    const event = status === SubscriptionStatus.ACTIVE ? 'expired' : 'expired_unconfirmed';
    for (const { _id: lang, count } of byLang) {
      await statistics.record(siteId, event, { lang: lang as SubscriptionCollectionLanguageType, count });
    }

    return deletedCount;
  } catch (error) {
    throw new Error('Could not delete subscriptions. See logs for errors.', {
      cause: error,
    });
  }
}

/**
 * Counts the doomed subscriptions per language, one row per language however many
 * are being deleted.
 *
 * Isolated from the deletion because statistics must never stop the cleanup: if
 * the server cannot run this pipeline, the day's expiry counters are lost and
 * reported, and the deletion goes ahead regardless.
 */
async function groupByLanguage(
  collection: Collection,
  filter: ExpiryFilter,
  siteId: string,
): Promise<{ _id: string; count: number }[]> {
  try {
    return await collection
      .aggregate<{ _id: string; count: number }>([{ $match: filter }, { $group: { _id: '$lang', count: { $sum: 1 } } }])
      .toArray();
  } catch (error) {
    console.error(`Could not group expiring subscriptions by language for ${siteId}`, error);
    Sentry.captureException(error);

    return [];
  }
}
