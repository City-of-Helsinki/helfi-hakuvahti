import type { Collection, ObjectId } from 'mongodb';
import type { SiteConfigurationType } from '../types/siteConfig';
import { type RenewalSubscriptionType, SubscriptionStatus } from '../types/subscription';

export interface ActionResult {
  success: boolean;
  statusCode: number;
  statusMessage: string;
  expiryDate?: string;
}

// Type for ATV update function (injected from Fastify decorator)
export type AtvUpdateFn = (docId: string, maxAge: number, fromDate: Date) => Promise<unknown>;

/**
 * Confirms a subscription by setting status from INACTIVE to ACTIVE.
 */
export async function confirmSubscription(collection: Collection, subscriptionId: ObjectId): Promise<ActionResult> {
  const result = await collection.updateOne(
    { _id: subscriptionId, sms_confirmed: false },
    {
      $set: { status: SubscriptionStatus.ACTIVE, sms_confirmed: true },
      $unset: { sms_code: 1, sms_code_created: 1 },
    },
  );

  if (result.modifiedCount === 0) {
    return {
      success: false,
      statusCode: 404,
      statusMessage: 'Subscription not found or already confirmed.',
    };
  }

  return {
    success: true,
    statusCode: 200,
    statusMessage: 'Subscription confirmed.',
  };
}

/**
 * Deletes a subscription.
 */
export async function deleteSubscription(collection: Collection, subscriptionId: ObjectId): Promise<ActionResult> {
  const result = await collection.deleteOne({ _id: subscriptionId });

  if (result.deletedCount === 0) {
    return {
      success: false,
      statusCode: 404,
      statusMessage: 'Subscription not found.',
    };
  }

  return {
    success: true,
    statusCode: 200,
    statusMessage: 'Subscription deleted.',
  };
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
  atvUpdateFn: AtvUpdateFn,
): Promise<ActionResult> {
  // Check ACTIVE status
  if (subscription.status !== SubscriptionStatus.ACTIVE) {
    return {
      success: false,
      statusCode: 400,
      statusMessage: 'Only active subscriptions can be renewed.',
    };
  }

  // Check renewal window
  const { maxAge, expiryNotificationDays } = siteConfig.subscription;
  const subscriptionExpiresAt = new Date(subscription.created).getTime() + maxAge * 24 * 60 * 60 * 1000;
  const expiryNotificationDate = new Date(subscriptionExpiresAt - expiryNotificationDays * 24 * 60 * 60 * 1000);

  if (Date.now() < expiryNotificationDate.getTime()) {
    return {
      success: false,
      statusCode: 400,
      statusMessage: 'Subscription cannot be renewed yet.',
    };
  }

  // Update ATV document delete_after
  const now = new Date();
  try {
    await atvUpdateFn(subscription.email, maxAge, now);
  } catch (_error) {
    return {
      success: false,
      statusCode: 500,
      statusMessage: 'Failed to update subscription expiry in storage.',
    };
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

  // Calculate new expiry date
  const newExpiryDate = new Date(Date.now() + maxAge * 24 * 60 * 60 * 1000);

  return {
    success: true,
    statusCode: 200,
    statusMessage: 'Subscription renewed successfully.',
    expiryDate: newExpiryDate.toISOString(),
  };
}
