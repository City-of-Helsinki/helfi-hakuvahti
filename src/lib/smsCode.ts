import { randomInt } from 'node:crypto';
import type { Collection } from 'mongodb';
import type { AtvDocumentType } from '../types/atv';
import type { SmsVerificationResultType, VerificationSubscriptionType } from '../types/subscription';

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
 * 1. Check code expiry
 * 2. Fetch phone from ATV and validate suffix
 *
 * @param subscription - The subscription found by sms_code
 * @param phoneSuffix - Last 3 digits of phone from user
 * @param expireMinutes - Minutes until code expires
 * @param atvQueryFn - Function to fetch ATV document content
 * @returns Verification result with subscription or error
 */
export async function verifySmsRequest(
  subscription: VerificationSubscriptionType,
  phoneSuffix: string,
  expireMinutes: number,
  atvQueryFn: AtvQueryFn,
): Promise<SmsVerificationResultType> {
  // Check code expiry
  if (!subscription.sms_code_created || isCodeExpired(new Date(subscription.sms_code_created), expireMinutes)) {
    return {
      success: false,
      error: { statusCode: 400, statusMessage: 'Verification code has expired.' },
    };
  }

  // Fetch phone number from ATV document content
  let storedPhone: string | undefined;
  try {
    // atvGetDocument returns unwrapped content (response.data.content)
    const atvContent = await atvQueryFn(subscription.email);
    const content = atvContent as { sms?: string } | undefined;
    storedPhone = content?.sms;
  } catch (_error) {
    return {
      success: false,
      error: { statusCode: 500, statusMessage: 'Failed to verify phone number.' },
    };
  }

  // Validate phone suffix
  if (!storedPhone || !validatePhoneSuffix(storedPhone, phoneSuffix)) {
    return {
      success: false,
      error: { statusCode: 401, statusMessage: 'Invalid verification.' },
    };
  }

  return {
    success: true,
    subscription,
  };
}
