import type { Collection } from 'mongodb';
import type { AtvDocumentType } from '../types/atv';
import type { SmsVerificationResultType, VerificationSubscriptionType } from '../types/subscription';
import { isCodeExpired, validatePhoneSuffix } from './smsCode';

// Type for ATV query function (matches Fastify decorator return type)
export type AtvQueryFn = (docId: string) => Promise<Partial<AtvDocumentType>>;

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
    const atvDoc = await atvQueryFn(subscription.email);
    // ATV stores the SMS in document.content.sms
    const content = atvDoc?.content as { sms?: string } | undefined;
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
