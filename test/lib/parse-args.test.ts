import * as assert from 'node:assert';
import { describe, test } from 'node:test';
import parseArgs, { stringArg } from '../../src/lib/parse-args.ts';

describe('parseArgs', () => {
  test('parses --key=value as a string', () => {
    const argv = parseArgs(['--site=etusivu']);
    assert.equal(argv.site, 'etusivu');
  });

  test('parses a flag without a value as boolean true', () => {
    const argv = parseArgs(['--dry-run']);
    assert.strictEqual(argv['dry-run'], true);
  });

  test('keeps numeric values as strings', () => {
    const argv = parseArgs(['--batch-size=100']);
    assert.strictEqual(argv['batch-size'], '100');
  });

  test('ignores arguments that are not -- flags', () => {
    const argv = parseArgs(['foo', '--site=fame', 'bar']);
    assert.equal(argv.site, 'fame');
    assert.equal(argv.foo, undefined);
    assert.equal(argv.bar, undefined);
  });

  test('parses a mix of values and flags', () => {
    const argv = parseArgs(['--site=etusivu', '--batch-size=50', '--dry-run']);
    assert.equal(argv.site, 'etusivu');
    assert.strictEqual(argv['batch-size'], '50');
    assert.strictEqual(argv['dry-run'], true);
  });

  test('returns an empty object for no arguments', () => {
    const argv = parseArgs([]);
    assert.deepEqual(argv, {});
  });
});

describe('stringArg', () => {
  test('returns the string value of a flag', () => {
    const argv = parseArgs(['--site=etusivu']);
    assert.equal(stringArg(argv, 'site'), 'etusivu');
  });

  test('returns undefined when the flag is unset', () => {
    const argv = parseArgs([]);
    assert.equal(stringArg(argv, 'site'), undefined);
  });

  test('returns undefined for a bare boolean flag', () => {
    const argv = parseArgs(['--site']);
    assert.equal(stringArg(argv, 'site'), undefined);
  });
});
