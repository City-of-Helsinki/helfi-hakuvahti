import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculateDeleteAfterDate,
  formatDateISO,
  formatErrorMessage,
  formatSubscriptionUpdateMessage,
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
  });

});
