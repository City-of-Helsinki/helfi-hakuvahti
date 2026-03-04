import type { Collection, Filter } from 'mongodb';
import { type SubscriptionCollectionType, SubscriptionStatus } from '../types/subscription';
import { ATV } from './atv';
import { SiteConfigurationLoader } from './siteConfigurationLoader';

type SubscriptionCollection = Collection<SubscriptionCollectionType>;
type SubscriptionFilter = Filter<SubscriptionCollectionType>;

export class ActionError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Confirms a subscription by setting status from INACTIVE to ACTIVE.
 */
export async function confirmSubscription(
  collection: SubscriptionCollection,
  filter: SubscriptionFilter,
  channel: 'email' | 'sms',
): Promise<void> {
  const confirmedField = `${channel}_confirmed` as 'email_confirmed' | 'sms_confirmed';

  const $set: Partial<SubscriptionCollectionType> = {
    status: SubscriptionStatus.ACTIVE,
    [confirmedField]: true,
    modified: new Date(),
  };

  const $unset: Partial<Record<keyof SubscriptionCollectionType, 1>> | undefined =
    channel === 'sms' ? { sms_code: 1, sms_code_created: 1 } : undefined;

  const result = await collection.updateOne(
    { [confirmedField]: false, ...filter },
    $unset ? { $set, $unset } : { $set },
  );

  if (result.modifiedCount === 0) {
    throw new ActionError(404, 'Subscription not found or already confirmed.');
  }
}

/**
 * Deletes a subscription.
 */
export async function deleteSubscription(
  collection: SubscriptionCollection,
  filter: SubscriptionFilter,
): Promise<void> {
  const result = await collection.deleteOne(filter);

  if (result.deletedCount === 0) {
    throw new ActionError(404, 'Subscription not found.');
  }
}

/**
 * Renews a subscription with full validation.
 * Finds the subscription by filter, validates status and renewal window,
 * updates ATV document, and resets subscription timestamps.
 *
 */
export async function renewSubscription(
  collection: SubscriptionCollection,
  filter: SubscriptionFilter,
  atv: ATV,
): Promise<void> {
  const subscription = await collection.findOne(filter);

  if (!subscription) {
    throw new ActionError(404, 'Subscription not found.');
  }

  // Check ACTIVE status
  if (subscription.status !== SubscriptionStatus.ACTIVE) {
    throw new ActionError(400, 'Only active subscriptions can be renewed.');
  }

  // Load site configuration
  const siteConfig = SiteConfigurationLoader.getConfiguration(subscription.site_id);

  if (!siteConfig) {
    throw new ActionError(500, 'Site configuration not found.');
  }

  // Check renewal window
  const { maxAge, expiryNotificationDays } = siteConfig.subscription;
  const subscriptionExpiresAt = new Date(subscription.created).getTime() + maxAge * 24 * 60 * 60 * 1000;
  const expiryNotificationDate = new Date(subscriptionExpiresAt - expiryNotificationDays * 24 * 60 * 60 * 1000);

  if (Date.now() < expiryNotificationDate.getTime()) {
    throw new ActionError(400, 'Subscription cannot be renewed yet.');
  }

  // Update ATV document delete_after
  const now = new Date();
  try {
    await atv.updateDocumentDeleteAfter(ATV.getAtvId(subscription), maxAge, now);
  } catch (_error) {
    throw new ActionError(500, 'Failed to update subscription expiry in storage.');
  }

  // Calculate new delete_after
  const newDeleteAfter = new Date(now);
  newDeleteAfter.setDate(newDeleteAfter.getDate() + maxAge);

  const $set: Partial<SubscriptionCollectionType> = {
    // Reset created so expiration checks (created + maxAge) use the renewed date,
    // not the original subscription creation date.
    created: now,
    modified: now,
    expiry_notification_sent: SubscriptionStatus.INACTIVE,
    delete_after: newDeleteAfter,
  };

  const $unset: Partial<Record<keyof SubscriptionCollectionType, 1>> = {
    sms_code: 1,
    sms_code_created: 1,
  };

  await collection.updateOne({ _id: subscription._id }, { $set, $unset });
}
