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
 * Age is measured from `created`, which is reset on renewal, against the site's
 * *current* maxAge — so lowering maxAge expires live subscriptions.
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

    // One language at a time, so each counter records what its own delete
    // removed: counting up front would let overlapping runs double count.
    for (const lang of SUBSCRIPTION_LANGUAGES) {
      const { deletedCount } = await collection.deleteMany({ ...filter, lang });

      if (deletedCount > 0) {
        await statistics.record(siteId, event, { lang, count: deletedCount });
        deleted += deletedCount;
      }
    }

    // The loop matches only known languages, so anything else would survive
    // every run. Swept, but not counted under a language we do not have.
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
