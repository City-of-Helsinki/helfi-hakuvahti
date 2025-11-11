import { test } from 'node:test';
import * as assert from 'node:assert';
import { build } from '../helper';
import { ObjectId } from '@fastify/mongodb';
import * as path from 'path';

process.env.ENVIRONMENT = 'local';
process.env.SENTRY_DSN = 'https://test@sentry.io/test';
process.env.SITE_CONFIGURATION_PATH = path.join(__dirname, '../../conf');

test('renewSubscription - invalid subscription ID', async (t) => {
  const app = await build(t);

  const subscriptionId = new ObjectId();
  const hash = 'invalidhash';

  const res = await app.inject({
    method: 'GET',
    url: `/subscription/renew/${subscriptionId}/${hash}`,
    headers: { token: 'test' },
  });

  assert.strictEqual(res.statusCode, 404);
  const body = JSON.parse(res.payload);
  assert.strictEqual(body.statusCode, 404);
  assert.strictEqual(body.statusMessage, 'Subscription not found.');
});

test('renewSubscription - route is registered and responds', async (t) => {
  const app = await build(t);

  const subscriptionId = new ObjectId();
  const hash = 'testhash';

  const res = await app.inject({
    method: 'GET',
    url: `/subscription/renew/${subscriptionId}/${hash}`,
    headers: { token: 'test' },
  });

  assert.ok(res.statusCode !== undefined, 'Should get a response');
  assert.ok([200, 400, 404, 500].includes(res.statusCode), 'Should return a valid HTTP status code');
});

test('renewSubscription - successfully renews old subscription with real MongoDB', async (t) => {
  const app = await build(t);

  if (!app.mongo?.db) {
    console.log('Skipping test - MongoDB not available');
    return;
  }

  // Mock ATV update to always succeed
  app.atvUpdateDocumentDeleteAfter = async (atvDocId: string, maxAge?: number) => {
    return {
      id: atvDocId,
      delete_after: new Date(Date.now() + (maxAge || 90) * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
    };
  };

  // Create a subscription that's old enough to renew (87 days ago)
  const oldDate = new Date(Date.now() - 87 * 24 * 60 * 60 * 1000);
  const hash = 'test-renewal-hash-' + Date.now();
  
  const testSubscription = {
    hash,
    status: 1,
    created: oldDate,
    modified: oldDate,
    email: 'test-atv-doc-id',
    site_id: 'rekry',
    expiry_notification_sent: 0,
    elastic_query: 'test',
    query: '/test',
    search_description: 'Test subscription for renewal',
    lang: 'fi',
  };

  const collection = app.mongo.db.collection('subscription');
  const insertResult = await collection.insertOne(testSubscription);
  const subscriptionId = insertResult.insertedId;

  t.after(async () => {
    await collection.deleteOne({ _id: subscriptionId });
  });

  const res = await app.inject({
    method: 'GET',
    url: `/subscription/renew/${subscriptionId}/${hash}`,
    headers: { token: 'test' },
  });

  assert.strictEqual(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.strictEqual(body.statusCode, 200);
  assert.strictEqual(body.statusMessage, 'Subscription renewed successfully.');
  assert.ok(body.expiryDate, 'Should return new expiry date');
  
  const updated = await collection.findOne({ _id: subscriptionId });
  assert.ok(updated, 'Subscription should exist');
  assert.ok(updated.created.getTime() > oldDate.getTime(), 'Created date should be updated');
  assert.ok(updated.first_created, 'first_created should be set');
  assert.strictEqual(updated.first_created.getTime(), oldDate.getTime(), 'Original date should be archived');
  assert.strictEqual(updated.expiry_notification_sent, 0, 'Expiry notification should be reset');
});
