import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import { build, createSubscription } from '../helper';
import { ObjectId } from '@fastify/mongodb';
import { SubscriptionStatus } from '../../src/types/subscription';

describe('/subscription/status', () => {
  test('404 response for unknown subscription', async (t) => {
    const app = await build(t);

    const res = await app.inject({
      method: 'GET',
      url: `/subscription/status/${new ObjectId()}/invalid`,
      headers: { token: 'test' },
    });

    assert.strictEqual(res.statusCode, 404);
  });

  test('correct values for status', async (t) => {
    const tests = [
      [SubscriptionStatus.INACTIVE, 'inactive'],
      [SubscriptionStatus.ACTIVE, 'active'],
      [SubscriptionStatus.DISABLED, 'disabled'],
    ] as const

    const app = await build(t);
    const collection = app.mongo.db?.collection('subscription');

    for (const [status, result] of tests) {
      const hash = crypto.randomUUID()
      const subscriptionId = await createSubscription(collection, {
        status,
        hash
      })

      const res = await app.inject({
        method: 'GET',
        url: `/subscription/status/${subscriptionId}/${hash}`,
        headers: { token: 'test' },
      });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(JSON.parse(res.payload).subscriptionStatus, result);
    }
  })
})
