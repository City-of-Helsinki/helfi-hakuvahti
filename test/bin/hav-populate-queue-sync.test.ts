import * as assert from 'node:assert';
import { describe, test } from 'node:test';
import {
  calculateExpectedDeleteAfter,
  needsDeleteAfterSync,
} from '../../src/lib/subscriptionProcessor';

describe('ATV delete_after sync helpers', () => {
  test('calculateExpectedDeleteAfter adds maxAge days to created date', () => {
    const createdDate = new Date('2025-01-15');
    const result = calculateExpectedDeleteAfter(createdDate, 90);
    assert.strictEqual(result.toISOString().substring(0, 10), '2025-04-15');
  });

  test('needsDeleteAfterSync returns true when stored is undefined', () => {
    assert.strictEqual(needsDeleteAfterSync(undefined, new Date('2025-04-15')), true);
  });

  test('needsDeleteAfterSync returns false when dates match', () => {
    const date = new Date('2025-04-15');
    assert.strictEqual(needsDeleteAfterSync(date, date), false);
  });

  test('needsDeleteAfterSync returns true when dates differ', () => {
    assert.strictEqual(
      needsDeleteAfterSync(new Date('2025-04-15'), new Date('2025-04-16')),
      true,
    );
  });
});
