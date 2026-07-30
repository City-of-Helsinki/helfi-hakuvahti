import type { ObjectId } from '@fastify/mongodb';
import type { Collection } from 'mongodb';
import type { SubscriptionCollectionType } from '../types/subscription.ts';
import { hotp } from './totp.ts';

export const TIME_WINDOW_MS = 30 * 60 * 1000;

export { hotp };

/**
 * Generate a 6-digit TOTP-like code from a secret.
 *
 * Based on RFC 6238 (TOTP) and RFC 4226 (HOTP).
 */
export function generateSmsCode(secret: string, timeStep?: number): string {
  const step = timeStep ?? Math.floor(Date.now() / TIME_WINDOW_MS);
  return hotp(Buffer.from(secret, 'hex'), step);
}

/**
 * Verify a 6-digit code against a secret.
 * Accepts the current and the previous time window for tolerance.
 */
export function verifySmsCode(secret: string, code: string): boolean {
  const currentStep = Math.floor(Date.now() / TIME_WINDOW_MS);
  return code === generateSmsCode(secret, currentStep) || code === generateSmsCode(secret, currentStep - 1);
}

/**
 * Find a subscription by ID and verify the SMS code.
 */
export async function findAndVerifySmsSubscription(
  collection: Collection<SubscriptionCollectionType> | undefined,
  id: ObjectId,
  smsCode: string,
): Promise<boolean> {
  const subscription = await collection?.findOne({ _id: id });

  return !(!subscription || !verifySmsCode(subscription.sms_secret, smsCode));
}
