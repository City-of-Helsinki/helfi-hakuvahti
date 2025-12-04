import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculateDeleteAfterDate,
  formatDateISO,
  formatErrorMessage,
  formatSubscriptionUpdateMessage,
  parseArguments,
} from '../../src/bin/hav-update-subscription-length';

describe('hav-update-subscription-length', () => {
  describe('calculateDeleteAfterDate', () => {
    it('should calculate delete_after date by adding maxAge days to created date', () => {
      const createdDate = new Date('2025-11-01T12:00:00.000Z');
      const maxAge = 90;
      const result = calculateDeleteAfterDate(createdDate, maxAge);

      // Expected: 2025-11-01 + 90 days = 2026-01-30
      assert.strictEqual(result.toISOString().substring(0, 10), '2026-01-30');
    });

    it('should handle different maxAge values', () => {
      const createdDate = new Date('2025-01-01T00:00:00.000Z');
      const maxAge = 180;
      const result = calculateDeleteAfterDate(createdDate, maxAge);

      // Expected: 2025-01-01 + 180 days = 2025-06-30
      assert.strictEqual(result.toISOString().substring(0, 10), '2025-06-30');
    });

    it('should not change the original date', () => {
      const createdDate = new Date('2025-11-01T12:00:00.000Z');
      const originalTime = createdDate.getTime();

      calculateDeleteAfterDate(createdDate, 90);
      assert.strictEqual(createdDate.getTime(), originalTime);
    });
  });

  describe('formatDateISO', () => {
    it('should format date to YYYY-MM-DD string', () => {
      const date = new Date('2025-12-01T15:30:45.123Z');
      const result = formatDateISO(date);

      assert.strictEqual(result, '2025-12-01');
    });

    it('should handle different dates correctly', () => {
      const date = new Date('2026-03-11T00:00:00.000Z');
      const result = formatDateISO(date);

      assert.strictEqual(result, '2026-03-11');
    });

    it('should strip time component', () => {
      const date = new Date('2025-01-15T23:59:59.999Z');
      const result = formatDateISO(date);

      assert.strictEqual(result, '2025-01-15');
    });
  });

  describe('formatSubscriptionUpdateMessage', () => {
    it('should format dry-run message correctly', () => {
      const createdDate = new Date('2025-12-01T12:00:00.000Z');
      const deleteAfter = new Date('2026-03-01T12:00:00.000Z');
      const result = formatSubscriptionUpdateMessage(1, 'abc123', createdDate, deleteAfter, true);

      assert.strictEqual(
        result,
        '1. [DRY RUN] Would update: abc123 | Created: 2025-12-01 | New delete_after: 2026-03-01',
      );
    });

    it('should format actual update message correctly', () => {
      const createdDate = new Date('2025-12-01T12:00:00.000Z');
      const deleteAfter = new Date('2026-03-01T12:00:00.000Z');
      const result = formatSubscriptionUpdateMessage(5, 'xyz789', createdDate, deleteAfter, false);

      assert.strictEqual(result, '5. Updated: xyz789 | Created: 2025-12-01 | New delete_after: 2026-03-01');
    });

    it('should handle different index values', () => {
      const createdDate = new Date('2025-11-15T00:00:00.000Z');
      const deleteAfter = new Date('2026-02-13T00:00:00.000Z');
      const result = formatSubscriptionUpdateMessage(42, 'test123', createdDate, deleteAfter, true);

      assert.match(result, /^42\. /);
      assert.match(result, /test123/);
    });
  });

  describe('formatErrorMessage', () => {
    it('should format error message with Error object', () => {
      const error = new Error('Connection timeout');
      const result = formatErrorMessage(1, 'abc123', error);

      assert.strictEqual(result, '1. Failed: abc123 | Error: Connection timeout');
    });

    it('should handle unknown error type', () => {
      const error = 'String error';
      const result = formatErrorMessage(2, 'xyz789', error);

      assert.strictEqual(result, '2. Failed: xyz789 | Error: Unknown error');
    });

    it('should handle null error', () => {
      const result = formatErrorMessage(3, 'test456', null);

      assert.strictEqual(result, '3. Failed: test456 | Error: Unknown error');
    });

    it('should handle undefined error', () => {
      const result = formatErrorMessage(4, 'test789', undefined);

      assert.strictEqual(result, '4. Failed: test789 | Error: Unknown error');
    });

    it('should handle different index values', () => {
      const error = new Error('ATV API failed');
      const result = formatErrorMessage(99, 'sub999', error);

      assert.match(result, /^99\. Failed:/);
      assert.match(result, /sub999/);
      assert.match(result, /ATV API failed/);
    });
  });

  describe('parseArguments', () => {
    it('should parse cli arguments correctly', () => {
      const args = ['--site=rekry', '--batch-size=50', '--dry-run'];
      const result = parseArguments(args);

      assert.strictEqual(result.siteId, 'rekry');
      assert.strictEqual(result.batchSize, 50);
      assert.strictEqual(result.dryRun, true);
    });

    it('should use default batch size of 100 if not provided', () => {
      const args = ['--site=rekry'];
      const result = parseArguments(args);

      assert.strictEqual(result.siteId, 'rekry');
      assert.strictEqual(result.batchSize, 100);
      assert.strictEqual(result.dryRun, false);
    });

    it('should return undefined siteId if not provided', () => {
      const args = ['--batch-size=25'];
      const result = parseArguments(args);

      assert.strictEqual(result.siteId, undefined);
      assert.strictEqual(result.batchSize, 25);
    });

    it('should handle dry-run flag', () => {
      const args = ['--site=rekry', '--dry-run'];
      const result = parseArguments(args);

      assert.strictEqual(result.dryRun, true);
    });

    it('should set dry-run to false when flag is not present', () => {
      const args = ['--site=rekry'];
      const result = parseArguments(args);

      assert.strictEqual(result.dryRun, false);
    });
  });
});
