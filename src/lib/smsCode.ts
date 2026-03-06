import { createHmac } from 'node:crypto';
import { ObjectId } from '@fastify/mongodb';
import type { Collection } from 'mongodb';
import type { SubscriptionCollectionType } from '../types/subscription';

const TIME_WINDOW_MS = 15 * 60 * 1000;

export function hotp(secret: Buffer, counter: number, algorithm: string = 'sha1', digits: number = 6): string {
  const stepBuffer = Buffer.alloc(8);

  stepBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac(algorithm, secret).update(stepBuffer).digest();

  // HOTP dynamic truncation (RFC 4226)
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  // code = truncation results % (10 ^ digits).
  return (code % 10 ** digits).toString().padStart(6, '0');
}

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
  id: string,
  smsCode: string,
): Promise<boolean> {
  const subscription = await collection?.findOne({ _id: new ObjectId(id) });

  if (!subscription || !verifySmsCode(subscription.sms_secret, smsCode)) {
    return false;
  }

  return true;
}
