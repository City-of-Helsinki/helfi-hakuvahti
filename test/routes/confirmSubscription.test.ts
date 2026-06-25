import * as assert from 'node:assert';
import { describe, test } from 'node:test';
import { ObjectId } from '@fastify/mongodb';
import { SubscriptionStatus } from '../../src/types/subscription.ts';
import { build, createSubscription } from '../helper.ts';

describe('/subscription/confirm', () => {
  test('malformed subscription id (email) returns 404, not 500', async (t) => {
    const app = await build(t);

    const res = await app.inject({
      method: 'POST',
      url: '/subscription/confirm/not-a-valid-id/somehash',
      headers: { Authorization: 'api-key test' },
    });

    assert.strictEqual(res.statusCode, 404);
  });

  test('malformed subscription id (sms) returns 404 before SMS verification, not 500', async (t) => {
    const app = await build(t);

    const res = await app.inject({
      method: 'POST',
      url: '/subscription/sms/confirm/not-a-valid-id',
      headers: { Authorization: 'api-key test' },
      payload: { code: '123456' },
    });

    assert.strictEqual(res.statusCode, 404);
  });

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

  test('returns 409 when subscription is already active', async (t) => {
    const app = await build(t);

    const collection = app.mongo.db?.collection('subscription');
    const hash = `test-hash-409-${Date.now()}`;
    const subscriptionId = await createSubscription(collection, {
      hash,
      status: SubscriptionStatus.ACTIVE,
      email_confirmed: true,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/subscription/confirm/${subscriptionId}/${hash}`,
      headers: { Authorization: 'api-key test' },
    });

    assert.strictEqual(res.statusCode, 409);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.statusMessage, 'Subscription is already confirmed');
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
