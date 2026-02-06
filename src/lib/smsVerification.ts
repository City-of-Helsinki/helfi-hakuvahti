import type { Collection } from 'mongodb';
import type { AtvDocumentType } from '../types/atv';
import type { SmsVerificationResultType, VerificationSubscriptionType } from '../types/subscription';
import { isCodeExpired, validatePhoneSuffix } from './smsCode';

// Type for ATV query function (matches Fastify decorator return type)
export type AtvQueryFn = (docId: string) => Promise<Partial<AtvDocumentType>>;

/**
 * Validates an SMS verification request.
 * 1. Find subscription by sms_code
 * 2. Check code expiry
 * 3. Fetch phone from ATV and validate suffix
 *
 * @param collection - MongoDB subscription collection
 * @param smsCode - The 6-digit code from user
 * @param phoneSuffix - Last 3 digits of phone from user
 * @param expireMinutes - Minutes until code expires
 * @param atvQueryFn - Function to fetch ATV document content
 * @returns Verification result with subscription or error
 */
export async function verifySmsRequest(
  collection: Collection,
  smsCode: string,
  phoneSuffix: string,
  expireMinutes: number,
  atvQueryFn: AtvQueryFn,
): Promise<SmsVerificationResultType> {
  // Find subscription by sms_code
  const subscription = (await collection.findOne({
    sms_code: smsCode,
    sms_code_created: { $exists: true },
  })) as VerificationSubscriptionType | null;

  if (!subscription) {
    return {
      success: false,
      error: { statusCode: 404, statusMessage: 'Invalid verification code.' },
    };
  }

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
