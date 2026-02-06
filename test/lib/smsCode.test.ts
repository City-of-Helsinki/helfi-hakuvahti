import * as assert from 'node:assert';
import { describe, test } from 'node:test';
import { isCodeExpired, validatePhoneSuffix } from '../../src/lib/smsCode';

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
      // Just under expiry
      const justUnder = new Date(Date.now() - 59 * 60 * 1000);
      assert.strictEqual(isCodeExpired(justUnder, 60), false);

      // Just over expiry
      const justOver = new Date(Date.now() - 61 * 60 * 1000);
      assert.strictEqual(isCodeExpired(justOver, 60), true);
    });
  });
});
