import * as assert from 'node:assert';
import { describe, test } from 'node:test';
import { isEmailDebugEnvironment } from '../../src/types/environment.ts';

describe('isEmailDebugEnvironment', () => {
  for (const environment of ['local', 'dev', 'staging']) {
    test(`is on in ${environment}`, () => {
      assert.strictEqual(isEmailDebugEnvironment(environment), true);
    });
  }

  for (const environment of ['production', 'prod', '', undefined]) {
    test(`is off for ${JSON.stringify(environment)}`, () => {
      assert.strictEqual(isEmailDebugEnvironment(environment), false);
    });
  }
});
