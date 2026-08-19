import * as Sentry from '@sentry/node';
import type { Db } from 'mongodb';
import { SUBSCRIPTION_LANGUAGES, SubscriptionStatus } from '../types/subscription.ts';
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

    const event = status === SubscriptionStatus.ACTIVE ? 'expired' : 'expired_unconfirmed';
    let deleted = 0;

    // Deleted one language at a time so each counter records what that delete
    // actually removed. Counting first and deleting in bulk would let two
    // overlapping cron runs both count rows only one of them deleted, inflating
    // `expired` by up to a full batch. Three small deletes per site instead of
    // one costs nothing at this volume and keeps `events` and `lang` in step.
    for (const lang of SUBSCRIPTION_LANGUAGES) {
      const { deletedCount } = await collection.deleteMany({ ...filter, lang });

      if (deletedCount > 0) {
        await statistics.record(siteId, event, { lang, count: deletedCount });
        deleted += deletedCount;
      }
    }

    // The loop above only matches the three known languages, so anything with a
    // missing or unrecognised `lang` would otherwise survive every run and
    // accumulate. Cleanup is this function's job, so sweep them — but do not
    // invent a language for a counter; report the anomaly once per run instead.
    const { deletedCount: unknownLang } = await collection.deleteMany({
      ...filter,
      lang: { $nin: [...SUBSCRIPTION_LANGUAGES] },
    });

    if (unknownLang > 0) {
      console.error(`Deleted ${unknownLang} subscription(s) with no usable lang for ${siteId}; not counted`);
      Sentry.captureMessage(`Expired ${unknownLang} subscription(s) with no usable lang for ${siteId}`);
      deleted += unknownLang;
    }

    return deleted;
  } catch (error) {
    throw new Error('Could not delete subscriptions. See logs for errors.', {
      cause: error,
    });
  }
}
