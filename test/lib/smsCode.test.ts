import * as assert from 'node:assert';
import { describe, test } from 'node:test';
import {
  type AtvQueryFn,
  generateUniqueSmsCode,
  isCodeExpired,
  validatePhoneSuffix,
  verifySmsRequest,
} from '../../src/lib/smsCode';
import type { VerificationSubscriptionType } from '../../src/types/subscription';

describe('smsCode', () => {
  describe('validatePhoneSuffix', () => {
    test('returns true for matching last 3 digits', () => {
      assert.strictEqual(validatePhoneSuffix('+358401234567', '567'), true);
      assert.strictEqual(validatePhoneSuffix('0401234567', '567'), true);
    });

    test('returns false for non-matching digits', () => {
      assert.strictEqual(validatePhoneSuffix('+358401234567', '123'), false);
      assert.strictEqual(validatePhoneSuffix('+358401234567', '566'), false);
    });

    test('handles edge cases', () => {
      assert.strictEqual(validatePhoneSuffix('', '567'), false);
      assert.strictEqual(validatePhoneSuffix('+358401234567', ''), false);
      // With spaces in phone number
      assert.strictEqual(validatePhoneSuffix('+358 40 123 4567', '567'), true);
    });
  });

  describe('isCodeExpired', () => {
    test('returns false for non-expired code', () => {
      const now = new Date();
      assert.strictEqual(isCodeExpired(now, 60), false);
    });

    test('returns true for expired code', () => {
      const oneHourAgo = new Date(Date.now() - 61 * 60 * 1000);
      assert.strictEqual(isCodeExpired(oneHourAgo, 60), true);
    });

    test('handles boundary correctly', () => {
      const justUnder = new Date(Date.now() - 59 * 60 * 1000);
      assert.strictEqual(isCodeExpired(justUnder, 60), false);

      const justOver = new Date(Date.now() - 61 * 60 * 1000);
      assert.strictEqual(isCodeExpired(justOver, 60), true);
    });
  });

  describe('generateUniqueSmsCode', () => {
    test('generates a 6-digit zero-padded string', async () => {
      const mockCollection = {
        findOne: () => Promise.resolve(null),
      };

      const code = await generateUniqueSmsCode(mockCollection as any);

      assert.strictEqual(code.length, 6, 'Code should be 6 characters');
      assert.match(code, /^\d{6}$/, 'Code should be 6 digits');
    });

    test('retries on collision and throws after max attempts', async () => {
      // Test retry behavior
      let retryCallCount = 0;
      const retryCollection = {
        findOne: () => {
          retryCallCount++;
          return Promise.resolve(retryCallCount <= 2 ? { sms_code: '123456' } : null);
        },
      };
      const code = await generateUniqueSmsCode(retryCollection as any);
      assert.strictEqual(code.length, 6);
      assert.strictEqual(retryCallCount, 3, 'Should have retried until no collision');

      // Test max attempts failure
      const alwaysCollides = {
        findOne: () => Promise.resolve({ sms_code: '123456' }),
      };
      await assert.rejects(() => generateUniqueSmsCode(alwaysCollides as any), {
        message: 'Failed to generate unique SMS code after maximum attempts',
      });
    });
  });

  describe('verifySmsRequest', () => {
    const makeSubscription = (overrides: Partial<VerificationSubscriptionType> = {}): VerificationSubscriptionType => ({
      _id: 'test-id',
      email: 'test-atv-doc-id',
      site_id: 'rekry',
      status: 1,
      created: new Date(),
      sms_code: '123456',
      sms_code_created: new Date(),
      ...overrides,
    });

    const makeAtvQueryFn = (phone?: string, shouldThrow = false): AtvQueryFn => {
      return async (_docId: string) => {
        if (shouldThrow) {
          throw new Error('ATV unavailable');
        }
        return { sms: phone } as any;
      };
    };

    test('rejects expired or missing verification code', async () => {
      // Missing sms_code_created
      const noCreated = makeSubscription({ sms_code_created: undefined });
      const result1 = await verifySmsRequest(noCreated, '567', 60, makeAtvQueryFn('+358401234567'));
      assert.strictEqual(result1.success, false);
      assert.strictEqual(result1.error?.statusCode, 400);

      // Expired code
      const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000);
      const expired = makeSubscription({ sms_code_created: twoHoursAgo });
      const result2 = await verifySmsRequest(expired, '567', 60, makeAtvQueryFn('+358401234567'));
      assert.strictEqual(result2.success, false);
      assert.strictEqual(result2.error?.statusCode, 400);
    });

    test('returns 500 when ATV query fails', async () => {
      const subscription = makeSubscription();
      const result = await verifySmsRequest(subscription, '567', 60, makeAtvQueryFn(undefined, true));

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.statusCode, 500);
    });

    test('rejects invalid phone verification', async () => {
      const subscription = makeSubscription();

      // Wrong suffix
      const result1 = await verifySmsRequest(subscription, '999', 60, makeAtvQueryFn('+358401234567'));
      assert.strictEqual(result1.success, false);
      assert.strictEqual(result1.error?.statusCode, 401);

      // Missing phone in ATV
      const result2 = await verifySmsRequest(subscription, '567', 60, makeAtvQueryFn(undefined));
      assert.strictEqual(result2.success, false);
      assert.strictEqual(result2.error?.statusCode, 401);
    });

    test('returns success when everything validates', async () => {
      const subscription = makeSubscription();
      const result = await verifySmsRequest(subscription, '567', 60, makeAtvQueryFn('+358401234567'));

      assert.strictEqual(result.success, true);
      assert.ok(result.subscription);
      assert.strictEqual(result.subscription._id, 'test-id');
      assert.strictEqual(result.error, undefined);
    });
  });
});
