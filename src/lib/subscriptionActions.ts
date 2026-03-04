import type { Collection, ObjectId } from 'mongodb';
import type { SiteConfigurationType } from '../types/siteConfig';
import { type RenewalSubscriptionType, SubscriptionStatus } from '../types/subscription';
import { ATV } from './atv';

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
export async function confirmSubscription(collection: Collection, subscriptionId: ObjectId): Promise<void> {
  const result = await collection.updateOne(
    { _id: subscriptionId, sms_confirmed: false },
    {
      $set: { status: SubscriptionStatus.ACTIVE, sms_confirmed: true },
      $unset: { sms_code: 1, sms_code_created: 1 },
    },
  );

  if (result.modifiedCount === 0) {
    throw new ActionError(404, 'Subscription not found or already confirmed.');
  }
}

/**
 * Deletes a subscription.
 */
export async function deleteSubscription(collection: Collection, subscriptionId: ObjectId): Promise<void> {
  const result = await collection.deleteOne({ _id: subscriptionId });

  // @fixme What if the user still has email subscription active?

  if (result.deletedCount === 0) {
    throw new ActionError(404, 'Subscription not found.');
  }
}

/**
 * Renews a subscription with full validation.
 * - Must be ACTIVE status
 * - Must be within renewal window (past expiry notification date)
 * - Updates ATV document delete_after
 * - Updates subscription timestamps
 */
export async function renewSubscription(
  collection: Collection,
  subscription: RenewalSubscriptionType,
  siteConfig: SiteConfigurationType,
  atv: ATV,
): Promise<void> {
  // Check ACTIVE status
  if (subscription.status !== SubscriptionStatus.ACTIVE) {
    throw new ActionError(400, 'Only active subscriptions can be renewed.');
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

  // Build update fields
  const updateFields: Record<string, unknown> = {
    created: now,
    modified: now,
    expiry_notification_sent: SubscriptionStatus.INACTIVE,
    delete_after: newDeleteAfter,
  };

  // Preserve original created date on first renewal
  if (!subscription.first_created) {
    updateFields.first_created = subscription.created;
  }

  await collection.updateOne(
    { _id: subscription._id as ObjectId },
    {
      $set: updateFields,
      $unset: { sms_code: 1, sms_code_created: 1 },
    },
  );
}
