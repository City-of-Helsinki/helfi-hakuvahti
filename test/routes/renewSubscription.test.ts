import * as assert from 'node:assert';
import { describe, mock, test } from 'node:test';
import { ObjectId } from '@fastify/mongodb';
import { SubscriptionStatus } from '../../src/types/subscription.ts';
import { build, createSubscription } from '../helper.ts';
import { captureSentryEvents } from '../lib/utils.ts';

const sentry = captureSentryEvents();

describe('/subscription/renew', () => {
  test('malformed subscription id returns 404, not 500', async (t) => {
    const app = await build(t);

    const emailRes = await app.inject({
      method: 'POST',
      url: '/subscription/renew/not-a-valid-id/somehash',
      headers: { Authorization: 'api-key test' },
    });
    assert.strictEqual(emailRes.statusCode, 404);

    const smsRes = await app.inject({
      method: 'POST',
      url: '/subscription/sms/renew/not-a-valid-id',
      headers: { Authorization: 'api-key test' },
    });
    assert.strictEqual(smsRes.statusCode, 404);
  });

  test('renewSubscription - invalid subscription ID', async (t) => {
    const app = await build(t);
    await sentry.take();

    const res = await app.inject({
      method: 'POST',
      url: `/subscription/renew/${new ObjectId()}/invalidhash`,
      headers: { Authorization: 'api-key test' },
    });

    assert.strictEqual(res.statusCode, 404);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.statusCode, 404);
    assert.strictEqual(body.statusMessage, 'Subscription not found.');
    assert.deepStrictEqual(await sentry.take(), [], "A 404 is the caller's problem, not reported");
  });

  test('ATV failure returns 500 and is reported with its cause', async (t) => {
    const app = await build(t);
    (app as any).atv.updateDocumentDeleteAfter = mock.fn(async () => {
      throw new Error('ATV request failed', { cause: new Error('ATV PATCH /v1/documents/doc-1 failed: 400') });
    });

    const hash = `test-renewal-hash-${Date.now()}`;
    const subscriptionId = await createSubscription(app.mongo.db?.collection('subscription'), {
      hash,
      site_id: 'rekry',
      status: SubscriptionStatus.ACTIVE,
    });
    await sentry.take();

    const res = await app.inject({
      method: 'POST',
      url: `/subscription/renew/${subscriptionId}/${hash}`,
      headers: { Authorization: 'api-key test' },
    });

    assert.strictEqual(res.statusCode, 500);
    assert.deepStrictEqual(await sentry.take(), [
      'Error: Failed to update subscription expiry in storage. <- Error: ATV request failed <- Error: ATV PATCH /v1/documents/doc-1 failed: 400',
    ]);
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

    const atvMock = mock.fn(async (atvDocId: string, deleteAfter: Date) => {
      return {
        id: atvDocId,
        delete_after: deleteAfter.toISOString().substring(0, 10),
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
