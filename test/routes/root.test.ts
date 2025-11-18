import { test } from 'node:test'
import * as assert from 'node:assert'
import { build } from '../helper'

test('default root route', async (t) => {
  const app = await build(t)

  const res = await app.inject({
    url: '/',
    headers: { token: 'test' }
  })
  assert.deepStrictEqual(JSON.parse(res.payload), { root: true })
})

test('/healthz', async (t) => {
  const app = await build(t)

  const res = await app.inject({
    url: '/healthz',
  })

  assert.strictEqual(res.statusCode, 200);
})

test('/readiness', async (t) => {
  const app = await build(t)

  const res = await app.inject({
    url: '/readiness',
  })

  assert.strictEqual(res.statusCode, 200);
})
