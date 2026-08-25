import { ObjectId } from '@fastify/mongodb';
import type { Collection, Filter } from 'mongodb';
import type { SiteConfigurationType } from '../types/siteConfig.ts';
import { type SubscriptionCollectionType, SubscriptionStatus } from '../types/subscription.ts';
import { ATV } from './atv.ts';
import { SiteConfigurationLoader } from './siteConfigurationLoader.ts';
import type { Statistics } from './statistics.ts';

export type SubscriptionCollection = Collection<SubscriptionCollectionType>;
export type SubscriptionFilter = Filter<SubscriptionCollectionType>;
export type SubscriptionChannel = 'email' | 'sms';

export class ActionError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string, cause?: unknown) {
    super(message, { cause });
    this.statusCode = statusCode;
  }
}

/**
 * Validates a subscription id path param and returns an ObjectId.
 */
export function toSubscriptionId(id: string | undefined): ObjectId {
  if (!id || !ObjectId.isValid(id)) {
    throw new ActionError(404, 'Subscription not found.');
  }

  return new ObjectId(id);
}

/**
 * Confirms a subscription by setting status from INACTIVE to ACTIVE.
 */
export async function confirmSubscription(
  collection: SubscriptionCollection | undefined,
  filter: SubscriptionFilter,
  channel: SubscriptionChannel,
  statistics: Statistics,
): Promise<void> {
  const confirmedField = `${channel}_confirmed` as 'email_confirmed' | 'sms_confirmed';

  const $set: Partial<SubscriptionCollectionType> = {
    status: SubscriptionStatus.ACTIVE,
    [confirmedField]: true,
    modified: new Date(),
  };

  // findOneAndUpdate so the previous status is known: that is what allows one
  // count per subscription rather than one per channel.
  const before = await collection?.findOneAndUpdate(
    { [confirmedField]: false, ...filter },
    { $set },
    {
      returnDocument: 'before',
      // Pinned: with metadata this is an always-truthy wrapper, turning the
      // 404 below into a silent success.
      includeResultMetadata: false,
    },
  );

  if (!before) {
    throw new ActionError(404, 'Subscription not found or already confirmed.');
  }

  // Only INACTIVE -> ACTIVE is a new confirmation, so a second channel does not
  // count twice. Tested against INACTIVE so DISABLED is not counted either.
  if (before.status === SubscriptionStatus.INACTIVE) {
    await statistics.record(before.site_id, 'confirmed', { lang: before.lang });
  }
}

/**
 * Deletes a subscription.
 */
export async function deleteSubscription(
  collection: SubscriptionCollection | undefined,
  filter: SubscriptionFilter,
  statistics: Statistics,
): Promise<void> {
  // The only moment "cancelled" is distinguishable from "expired": afterwards
  // both are an absent row.
  const deleted = await collection?.findOneAndDelete(filter, { includeResultMetadata: false });

  if (!deleted) {
    throw new ActionError(404, 'Subscription not found.');
  }

  // Only the unconfirmed funnel is an abandoned signup; DISABLED is neither.
  if (deleted.status === SubscriptionStatus.ACTIVE || deleted.status === SubscriptionStatus.INACTIVE) {
    await statistics.record(
      deleted.site_id,
      deleted.status === SubscriptionStatus.ACTIVE ? 'cancelled' : 'cancelled_unconfirmed',
      { lang: deleted.lang },
    );
  }
}

/**
 * Wraps SiteConfigurationLoader.getConfiguration exception type.
 */
function getSiteConfiguration(siteId: string): SiteConfigurationType {
  try {
    return SiteConfigurationLoader.getConfiguration(siteId);
  } catch (e) {
    throw new ActionError(500, 'Site configuration not found.', e);
  }
}

/**
 * Renews a subscription with full validation.
 * Finds the subscription by filter, validates status and renewal window,
 * updates ATV document, and resets subscription timestamps.
 *
 */
export async function renewSubscription(
  collection: SubscriptionCollection | undefined,
  filter: SubscriptionFilter,
  atv: ATV,
): Promise<void> {
  const subscription = await collection?.findOne(filter);
  if (!collection || !subscription) {
    throw new ActionError(404, 'Subscription not found.');
  }

  // Check ACTIVE status
  if (subscription.status !== SubscriptionStatus.ACTIVE) {
    throw new ActionError(400, 'Only active subscriptions can be renewed.');
  }

  const siteConfig = getSiteConfiguration(subscription.site_id);
  const { maxAge } = siteConfig.subscription;

  // Update ATV document delete_after
  const now = new Date();
  const newDeleteAfter = new Date(now);
  newDeleteAfter.setDate(newDeleteAfter.getDate() + maxAge);
  try {
    await atv.updateDocumentDeleteAfter(ATV.getAtvId(subscription), newDeleteAfter);
  } catch (_error) {
    throw new ActionError(500, 'Failed to update subscription expiry in storage.');
  }

  const $set: Partial<SubscriptionCollectionType> = {
    // Reset created so expiration checks (created + maxAge) use the renewed date,
    // not the original subscription creation date.
    created: now,
    modified: now,
    expiry_notification_sent: SubscriptionStatus.INACTIVE,
    delete_after: newDeleteAfter,
  };

  await collection.updateOne({ _id: subscription._id }, { $set });
}
