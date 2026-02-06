import type { Collection } from 'mongodb';

/**
 * Generates a unique 6-digit SMS verification code.
 * Retries up to maxAttempts to avoid collisions with existing active codes.
 */
export async function generateUniqueSmsCode(collection: Collection | undefined): Promise<string> {
  const maxAttempts = 10;

  for (let i = 0; i < maxAttempts; i++) {
    const code = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');

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
