import { randomInt } from 'node:crypto';
import type { Collection } from 'mongodb';
import type { AtvDocumentType } from '../types/atv';
import type { SiteConfigurationType } from '../types/siteConfig';
import type { VerificationSubscriptionType } from '../types/subscription';
import { getAtvId } from './atvId';

export type SmsAction = 'confirm' | 'delete' | 'renew';

// Type for ATV query function (matches Fastify decorator return type)
export type AtvQueryFn = (docId: string) => Promise<Partial<AtvDocumentType>>;

/**
 * Generates a unique 6-digit SMS verification code.
 * Retries up to maxAttempts to avoid collisions with existing active codes.
 */
export async function generateUniqueSmsCode(collection: Collection | undefined): Promise<string> {
  const maxAttempts = 10;

  for (let i = 0; i < maxAttempts; i++) {
    const code = String(randomInt(1000000)).padStart(6, '0');

    // Check if code exists among active subscriptions
    const existing = await collection?.findOne({
      sms_code: code,
      sms_code_created: { $exists: true },
    });

    if (!existing) {
      return code;
    }
  }

  throw new Error('Failed to generate unique SMS code after maximum attempts');
}

/**
 * Validates that the input matches the last 3 digits of the stored phone number.
 */
export function validatePhoneSuffix(storedPhone: string, inputSuffix: string): boolean {
  if (!storedPhone || !inputSuffix) {
    return false;
  }

  // Extract digits only
  const phoneDigits = storedPhone.replace(/\D/g, '');
  const inputDigits = inputSuffix.replace(/\D/g, '');

  // Get last 3 digits of stored phone
  const last3 = phoneDigits.slice(-3);

  return last3 === inputDigits;
}

/**
 * Checks if an SMS code has expired based on creation time and expiry minutes.
 */
export function isCodeExpired(codeCreated: Date, expireMinutes: number): boolean {
  const expiresAt = new Date(codeCreated).getTime() + expireMinutes * 60 * 1000;
  return Date.now() > expiresAt;
}

/**
 * Find a subscription by its SMS verification code.
 */
export async function findSubscriptionByCode(
  collection: Collection,
  smsCode: string,
): Promise<VerificationSubscriptionType | null> {
  return (await collection.findOne({
    sms_code: smsCode,
    sms_code_created: { $exists: true },
  })) as VerificationSubscriptionType | null;
}

/**
 * Validates an SMS verification request.
 * Checks code expiry, fetches the phone number from ATV, and validates the suffix.
 * Throws on ATV errors (caller/framework handles 500).
 */
export async function verifySmsRequest(
  subscription: VerificationSubscriptionType,
  phoneSuffix: string,
  siteConfig: SiteConfigurationType,
  action: SmsAction,
  atvQueryFn: AtvQueryFn,
): Promise<boolean> {
  const expireMinutes =
    action === 'confirm'
      ? (siteConfig.subscription.smsCodeExpireConfirmMinutes ?? 60)
      : (siteConfig.subscription.smsCodeExpireActionMinutes ?? 720);

  if (!subscription.sms_code_created || isCodeExpired(new Date(subscription.sms_code_created), expireMinutes)) {
    return false;
  }

  const atvContent = await atvQueryFn(getAtvId(subscription));
  const storedPhone = (atvContent as { sms?: string } | undefined)?.sms;

  return !!storedPhone && validatePhoneSuffix(storedPhone, phoneSuffix);
}
