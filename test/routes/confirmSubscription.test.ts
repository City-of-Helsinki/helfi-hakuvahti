import * as assert from 'node:assert';
import { describe, test } from 'node:test';
import { ObjectId } from '@fastify/mongodb';
import { SubscriptionStatus } from '../../src/types/subscription';
import { build, createSubscription } from '../helper';

describe('/subscription/confirm', () => {
  test('invalid subscription ID', async (t) => {
    const app = await build(t);

    const res = await app.inject({
      method: 'GET',
      url: `/subscription/confirm/${new ObjectId()}/invalid`,
      headers: { Authorization: 'api-key test' },
    });

    assert.strictEqual(res.statusCode, 404);
  });

  test('invalid subscription hash', async (t) => {
    const app = await build(t);

    const collection = app.mongo.db?.collection('subscription');
    const subscriptionId = await createSubscription(collection);

    const res = await app.inject({
      method: 'GET',
      url: `/subscription/confirm/${subscriptionId}/invalid`,
      headers: { Authorization: 'api-key test' },
    });

    assert.strictEqual(res.statusCode, 404);

    // Verify the subscription status was actually updated in MongoDB
    const updatedSubscription = await collection?.findOne({ _id: subscriptionId });
    assert.strictEqual(updatedSubscription?.status, SubscriptionStatus.INACTIVE, 'Status should be INACTIVE');
  });

  test('valid requests are confirmed and status changes from INACTIVE to ACTIVE', async (t) => {
    const app = await build(t);

    const collection = app.mongo.db?.collection('subscription');
    const hash = `test-hash-123-${Date.now()}`;
    const subscriptionId = await createSubscription(collection, { hash });

    const res = await app.inject({
      method: 'GET',
      url: `/subscription/confirm/${subscriptionId}/${hash}`,
      headers: { Authorization: 'api-key test' },
    });

    assert.strictEqual(res.statusCode, 200);

    // Verify the subscription status was actually updated in MongoDB
    const updatedSubscription = await collection?.findOne({ _id: subscriptionId });
    assert.strictEqual(updatedSubscription?.status, SubscriptionStatus.ACTIVE, 'Status should be ACTIVE');
  });
});
