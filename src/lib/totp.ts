import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Time-based one-time passwords (RFC 6238) on top of HOTP (RFC 4226).
 */

/** Standard TOTP step, compatible with authenticator apps. */
export const TOTP_STEP_MS = 30 * 1000;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

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
 * Decode a base32 (RFC 4648) secret into bytes.
 *
 * @throws If the secret is empty or contains non-base32 characters.
 */
export function decodeBase32(secret: string): Buffer {
  const normalized = secret.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();

  if (normalized.length === 0) {
    throw new Error('Base32 secret is empty.');
  }

  const bytes: number[] = [];
  let value = 0;
  let bits = 0;

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);

    if (index === -1) {
      throw new Error(`Invalid base32 character: ${character}`);
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }

  if (bytes.length === 0) {
    throw new Error('Base32 secret is too short.');
  }

  return Buffer.from(bytes);
}

/**
 * Generate a 6-digit code for the given time step.
 *
 * The step is a parameter instead of being read from the clock so that
 * callers decide the window and tests need no time mocking.
 */
export function generateTotp(secret: Buffer, step: number): string {
  return hotp(secret, step);
}

/**
 * Verify a 6-digit code against a secret.
 *
 * Steps within the tolerance on both sides of the current one are accepted
 * to allow for clock skew between the server and the authenticator app.
 */
export function verifyTotp(secret: Buffer, code: string, currentStep: number, tolerance: number = 1): boolean {
  const received = Buffer.from(code);
  let valid = false;

  for (let offset = -tolerance; offset <= tolerance; offset++) {
    const expected = Buffer.from(generateTotp(secret, currentStep + offset));

    // No early exit: every candidate is compared so that the runtime does
    // not depend on which step matched.
    if (expected.length === received.length && timingSafeEqual(expected, received)) {
      valid = true;
    }
  }

  return valid;
}
