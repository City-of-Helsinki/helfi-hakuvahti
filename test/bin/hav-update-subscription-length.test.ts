import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateDeleteAfterDate, parseArguments } from '../../src/bin/hav-update-subscription-length';

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
