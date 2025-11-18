import * as assert from 'node:assert';
import { describe, test } from 'node:test';
import { ObjectId } from '@fastify/mongodb';
import { build, createSubscription } from '../helper';

describe('/subscription/delete', () => {
  test('invalid subscription ID', async (t) => {
    const app = await build(t);

    const res = await app.inject({
      method: 'DELETE',
      url: `/subscription/delete/${new ObjectId()}/invalid`,
      headers: { token: 'test' },
    });

    assert.strictEqual(res.statusCode, 404);
  });

  test('invalid subscription hash', async (t) => {
    const app = await build(t);

    const collection = app.mongo.db?.collection('subscription');
    const subscriptionId = await createSubscription(collection);

    const res = await app.inject({
      method: 'DELETE',
      url: `/subscription/delete/${subscriptionId}/invalid`,
      headers: { token: 'test' },
    });

    assert.strictEqual(res.statusCode, 404);

    // Verify the subscription status was actually updated in MongoDB
    const updatedSubscription = await collection?.findOne({ _id: subscriptionId });
    assert.ok(updatedSubscription, 'Subscription was not deleted');
  });

  test('valid requests deletes the subscription', async (t) => {
    const app = await build(t);

    const collection = app.mongo.db?.collection('subscription');
    const hash = `test-hash-123-${Date.now()}`;
    const subscriptionId = await createSubscription(collection, { hash });

    const res = await app.inject({
      method: 'DELETE',
      url: `/subscription/delete/${subscriptionId}/${hash}`,
      headers: { token: 'test' },
    });

    assert.strictEqual(res.statusCode, 200);

    // Verify the subscription status was actually updated in MongoDB
    const updatedSubscription = await collection?.findOne({ _id: subscriptionId });
    assert.ok(!updatedSubscription, 'Subscription was deleted');
  });
});
