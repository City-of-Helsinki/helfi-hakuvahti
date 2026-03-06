import * as assert from 'node:assert';
import { describe, test } from 'node:test';
import { ObjectId } from '@fastify/mongodb';
import { SubscriptionStatus } from '../../src/types/subscription';
import { build, createSubscription } from '../helper';

describe('/subscription/confirm', () => {
  test('invalid subscription ID', async (t) => {
    const app = await build(t);

    const res = await app.inject({
      method: 'POST',
      url: `/subscription/confirm/${new ObjectId()}/invalid`,
      headers: { Authorization: 'api-key test' },
    });

    assert.strictEqual(res.statusCode, 404);
  });

  test('invalid subscription hash', async (t) => {
    const app = await build(t);

    const collection = app.mongo.db?.collection('subscription');
    const subscriptionId = await createSubscription(collection, { email_confirmed: false });

    const res = await app.inject({
      method: 'POST',
      url: `/subscription/confirm/${subscriptionId}/invalid`,
      headers: { Authorization: 'api-key test' },
    });

    assert.strictEqual(res.statusCode, 404);

    // Verify the subscription status was not updated in MongoDB
    const updatedSubscription = await collection?.findOne({ _id: subscriptionId });
    assert.strictEqual(updatedSubscription?.status, SubscriptionStatus.INACTIVE, 'Status should be INACTIVE');
    assert.strictEqual(updatedSubscription?.email_confirmed, false, 'email_confirmed should remain false');
  });

  test('valid requests are confirmed and email_confirmed becomes true', async (t) => {
    const app = await build(t);

    const collection = app.mongo.db?.collection('subscription');
    const hash = `test-hash-123-${Date.now()}`;
    const subscriptionId = await createSubscription(collection, { hash, email_confirmed: false });

    const res = await app.inject({
      method: 'POST',
      url: `/subscription/confirm/${subscriptionId}/${hash}`,
      headers: { Authorization: 'api-key test' },
    });

    assert.strictEqual(res.statusCode, 200);

    // Verify the subscription was updated in MongoDB
    const updatedSubscription = await collection?.findOne({ _id: subscriptionId });
    assert.strictEqual(updatedSubscription?.status, SubscriptionStatus.ACTIVE, 'Status should be ACTIVE');
    assert.strictEqual(updatedSubscription?.email_confirmed, true, 'email_confirmed should be true');
  });

  test('confirming email does not set sms_confirmed', async (t) => {
    const app = await build(t);

    const collection = app.mongo.db?.collection('subscription');
    const hash = `test-hash-456-${Date.now()}`;
    const subscriptionId = await createSubscription(collection, {
      hash,
      email_confirmed: false,
      sms_confirmed: false,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/subscription/confirm/${subscriptionId}/${hash}`,
      headers: { Authorization: 'api-key test' },
    });

    assert.strictEqual(res.statusCode, 200);

    const updatedSubscription = await collection?.findOne({ _id: subscriptionId });
    assert.strictEqual(updatedSubscription?.email_confirmed, true, 'email_confirmed should be true');
    assert.strictEqual(updatedSubscription?.sms_confirmed, false, 'sms_confirmed should remain false');
  });
});
