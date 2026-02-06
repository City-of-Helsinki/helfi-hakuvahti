import * as assert from 'node:assert';
import { describe, test } from 'node:test';

describe('rateLimit', () => {
  const rateLimits = new Map<string, { count: number; resetAt: number }>();

  const checkRateLimit = (key: string, maxAttempts = 5, windowMs = 15 * 60 * 1000): boolean => {
    const now = Date.now();
    const entry = rateLimits.get(key);

    if (!entry || now > entry.resetAt) {
      rateLimits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }

    if (entry.count >= maxAttempts) {
      return false;
    }

    entry.count++;
    return true;
  };

  test('allows requests under limit', () => {
    rateLimits.clear();
    const key = 'test-key-1';

    // First 5 requests should be allowed
    for (let i = 0; i < 5; i++) {
      assert.strictEqual(checkRateLimit(key), true, `Request ${i + 1} should be allowed`);
    }
  });

  test('blocks requests over limit', () => {
    rateLimits.clear();
    const key = 'test-key-2';

    // Use up all 5 attempts
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key);
    }

    // 6th request should be blocked
    assert.strictEqual(checkRateLimit(key), false, 'Request 6 should be blocked');
    assert.strictEqual(checkRateLimit(key), false, 'Request 7 should also be blocked');
  });
});
