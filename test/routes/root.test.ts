import * as assert from 'node:assert';
import { test } from 'node:test';
import { build } from '../helper';

test('default root route', async (t) => {
  const app = await build(t);

  const res = await app.inject({
    url: '/',
    headers: { Authorization: 'api-key test' },
  });

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(res.payload), { root: true });
});

test('api key validation', async (t) => {
  const app = await build(t);

  const res = await app.inject({
    url: '/',
    headers: { Authorization: 'api-key invalid' },
  });

  assert.strictEqual(res.statusCode, 403);
});

test('/healthz', async (t) => {
  const app = await build(t);

  const res = await app.inject({
    url: '/healthz',
  });

  assert.strictEqual(res.statusCode, 200);
});

test('/readiness', async (t) => {
  const app = await build(t);

  const res = await app.inject({
    url: '/readiness',
  });

  assert.strictEqual(res.statusCode, 200);
});
