import * as assert from 'node:assert';
import { describe, mock, test } from 'node:test';
import { ObjectId } from '@fastify/mongodb';
import { SubscriptionStatus } from '../../src/types/subscription';
import { build, createSubscription } from '../helper';

describe('/subscription/renew', () => {
  test('renewSubscription - invalid subscription ID', async (t) => {
    const app = await build(t);

    const res = await app.inject({
      method: 'POST',
      url: `/subscription/renew/${new ObjectId()}/invalidhash`,
      headers: { Authorization: 'api-key test' },
    });

    assert.strictEqual(res.statusCode, 404);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.statusCode, 404);
    assert.strictEqual(body.statusMessage, 'Subscription not found.');
  });

  test('Only active subscriptions can be renewed', async (t) => {
    const app = await build(t);

    const collection = app.mongo.db?.collection('subscription');
    const hash = 'test-renewal-hash-' + Date.now();
    const subscriptionId = await createSubscription(collection, {
      hash,
      status: SubscriptionStatus.INACTIVE,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/subscription/renew/${subscriptionId}/${hash}`,
      headers: { Authorization: 'api-key test' },
    });

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(JSON.parse(res.payload).statusMessage, 'Only active subscriptions can be renewed.');
  });

  test('renewSubscription - successfully renews old subscription', async (t) => {
    const app = await build(t);

    const atvMock = mock.fn(async (atvDocId: string, maxAge?: number, fromDate?: Date) => {
      const baseDate = fromDate || new Date();
      return {
        id: atvDocId,
        delete_after: new Date(baseDate.getTime() + (maxAge || 90) * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
      };
    });

    // Mock ATV update to always succeed
    (app as any).atv.updateDocumentDeleteAfter = atvMock;

    // Create a subscription that's old enough to renew (87 days ago)
    const oldDate = new Date(Date.now() - 87 * 24 * 60 * 60 * 1000);
    const hash = 'test-renewal-hash-' + Date.now();

    const collection = app.mongo.db?.collection('subscription');
    const subscriptionId = await createSubscription(collection, {
      hash,
      site_id: 'rekry',
      status: SubscriptionStatus.ACTIVE,
      created: oldDate,
      modified: oldDate,
      expiry_notification_sent: 0,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/subscription/renew/${subscriptionId}/${hash}`,
      headers: { Authorization: 'api-key test' },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.statusCode, 200);
    assert.strictEqual(body.statusMessage, 'Subscription renewed successfully.');

    const updated = await collection?.findOne({ _id: subscriptionId });
    assert.ok(updated, 'Subscription should exist');
    assert.ok(updated?.modified.getTime() > oldDate.getTime(), 'Modified date should be updated');
    assert.strictEqual(updated?.expiry_notification_sent, 0, 'Expiry notification should be reset');

    // Verify delete_after is updated on renewal
    assert.ok(updated?.delete_after, 'delete_after should be set after renewal');

    assert.ok(atvMock.mock.callCount() >= 1);
  });
});
