import * as assert from 'node:assert';
import { describe, test } from 'node:test';
import { ATV } from '../../src/lib/atv';

describe('getAtvId', () => {
  test('prefers atv_id over email', () => {
    assert.strictEqual(ATV.getAtvId({ atv_id: 'atv-123', email: 'legacy-email' }), 'atv-123');
  });

  test('falls back to email when atv_id is missing', () => {
    assert.strictEqual(ATV.getAtvId({ email: 'legacy-email' }), 'legacy-email');
  });

  test('falls back to email when atv_id is empty', () => {
    assert.strictEqual(ATV.getAtvId({ atv_id: '', email: 'legacy-email' }), 'legacy-email');
  });

  test('returns empty string when both are missing', () => {
    assert.strictEqual(ATV.getAtvId({}), '');
  });
});
