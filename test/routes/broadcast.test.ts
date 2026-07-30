import * as assert from 'node:assert';
import { before, describe, mock, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { SubscriptionStatus } from '../../src/types/subscription.ts';
import { build, createSubscription } from '../helper.ts';

// Contact details returned by the mocked ATV batch-list endpoint, by ATV id.
const atvDocs: Record<string, { email?: string; sms?: string }> = {
  'atv-a': { email: 'a@example.com' },
  'atv-b': { email: 'b@example.com' },
  'atv-b2': { email: 'b@example.com' },
};

const validPayload = {
  site_id: 'rekry',
  messages: {
    fi: { subject: 'Huoltokatko', body: 'FI body' },
    sv: { subject: 'Underhåll', body: 'SV body' },
    en: { subject: 'Maintenance', body: 'EN body' },
  },
};

async function cleanDatabase(app: FastifyInstance) {
  const db = app.mongo.db;
  await db?.collection('subscription').deleteMany({});
  await db?.collection('queue').deleteMany({});
}

async function waitForBroadcast(app: FastifyInstance, id: string) {
  for (let i = 0; i < 100; i++) {
    const res = await app.inject({
      method: 'GET',
      url: `/broadcast/${id}`,
      headers: { Authorization: 'api-key test' },
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    if (body.status !== 'processing') {
      return body;
    }
    await sleep(50);
  }
  assert.fail('Broadcast did not finish in time.');
}

describe('/broadcast', () => {
  before(() => {
    mock.method(globalThis, 'fetch', async (url: string, options?: { body?: string }) => {
      if (url.includes('/v1/documents/batch-list/')) {
        const { document_ids: ids } = JSON.parse(options?.body ?? '{}') as { document_ids: string[] };
        const docs = ids.filter((id) => atvDocs[id]).map((id) => ({ id, content: atvDocs[id] }));
        return new Response(JSON.stringify(docs), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
  });

  test('requires a valid api key', async (t) => {
    const app = await build(t);

    const res = await app.inject({
      method: 'POST',
      url: '/broadcast',
      headers: { Authorization: 'api-key wrong' },
      payload: validPayload,
    });

    assert.strictEqual(res.statusCode, 403);
  });

  test('rejects invalid input', async (t) => {
    const app = await build(t);
    await cleanDatabase(app);

    const testCases = [
      {
        name: 'invalid site_id',
        payload: { ...validPayload, site_id: 'nonexistent-site' },
        expectedError: 'Invalid site_id',
      },
      {
        name: 'missing language',
        payload: { ...validPayload, messages: { fi: validPayload.messages.fi, en: validPayload.messages.en } },
      },
      {
        name: 'empty subject',
        payload: {
          ...validPayload,
          messages: { ...validPayload.messages, fi: { subject: '', body: 'FI body' } },
        },
      },
      {
        name: 'SMS text for only one language',
        payload: {
          ...validPayload,
          messages: { ...validPayload.messages, fi: { ...validPayload.messages.fi, sms: 'FI sms' } },
        },
        expectedError: 'SMS text must be provided',
      },
      {
        name: 'malformed subscription id',
        payload: { ...validPayload, subscription_ids: ['not-an-object-id'] },
        expectedError: 'Invalid subscription id',
      },
      {
        name: 'empty subscription_ids array',
        payload: { ...validPayload, subscription_ids: [] },
      },
    ];

    for (const { name, payload, expectedError } of testCases) {
      await t.test(name, async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/broadcast',
          headers: { Authorization: 'api-key test' },
          payload,
        });

        assert.strictEqual(res.statusCode, 400);

        if (expectedError) {
          const body = JSON.parse(res.body);
          assert.ok(body.error.includes(expectedError), `error should include "${expectedError}"`);
        }
      });
    }
  });

  test('broadcasts to all active subscribers of the site', async (t) => {
    const app = await build(t);
    await cleanDatabase(app);
    const subscriptions = app.mongo.db?.collection('subscription');

    const active = { site_id: 'rekry', status: SubscriptionStatus.ACTIVE, email_confirmed: true, lang: 'fi' };
    await createSubscription(subscriptions, { ...active, atv_id: 'atv-a', email: '' });
    await createSubscription(subscriptions, { ...active, atv_id: 'atv-b', email: '', lang: 'en' });
    // Same email address as atv-b: must be deduplicated.
    await createSubscription(subscriptions, { ...active, atv_id: 'atv-b2', email: '', lang: 'en' });
    // Different site: must not receive the broadcast.
    await createSubscription(subscriptions, { ...active, atv_id: 'atv-a', email: '', site_id: 'etusivu' });

    const res = await app.inject({
      method: 'POST',
      url: '/broadcast',
      headers: { Authorization: 'api-key test' },
      payload: validPayload,
    });

    assert.strictEqual(res.statusCode, 202);
    const { id } = JSON.parse(res.body);
    assert.ok(id);

    const status = await waitForBroadcast(app, id);
    assert.strictEqual(status.status, 'completed');
    assert.strictEqual(status.site_id, 'rekry');
    assert.strictEqual(status.test, false);
    assert.deepStrictEqual(status.stats, {
      subscriptionsChecked: 3,
      emailsQueued: 2,
      smsQueued: 0,
      missingContacts: 0,
    });

    const queueItems = await app.mongo.db
      ?.collection('queue')
      .find({ type: { $in: ['email', 'sms'] } })
      .toArray();
    assert.strictEqual(queueItems?.length, 2);
    const fiItem = queueItems?.find((item) => item.atv_id === 'atv-a');
    assert.ok(fiItem?.content.includes('<title>Huoltokatko</title>'));
    assert.ok(fiItem?.content.includes('FI body'));

    // The status record shares the queue collection.
    const statusRecord = await app.mongo.db?.collection('queue').findOne({ type: 'broadcast' });
    assert.strictEqual(statusRecord?.status, 'completed');
  });

  test('rejects a broadcast while another one is processing', async (t) => {
    const app = await build(t);
    await cleanDatabase(app);

    await app.mongo.db?.collection('queue').insertOne({
      type: 'broadcast',
      site_id: 'rekry',
      status: 'processing',
      test: false,
      created: new Date(),
      stats: null,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/broadcast',
      headers: { Authorization: 'api-key test' },
      payload: validPayload,
    });

    assert.strictEqual(res.statusCode, 409);
  });

  test('ignores stale and test processing records', async (t) => {
    const app = await build(t);
    await cleanDatabase(app);

    await app.mongo.db?.collection('queue').insertMany([
      // Stale: a pod killed mid-broadcast must not block the site forever.
      {
        type: 'broadcast',
        site_id: 'rekry',
        status: 'processing',
        test: false,
        created: new Date(Date.now() - 31 * 60 * 1000),
        stats: null,
      },
      // Test sends never block a real broadcast.
      { type: 'broadcast', site_id: 'rekry', status: 'processing', test: true, created: new Date(), stats: null },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/broadcast',
      headers: { Authorization: 'api-key test' },
      payload: validPayload,
    });

    assert.strictEqual(res.statusCode, 202);
  });

  test('test mode sends only to the given subscriptions and skips the guard', async (t) => {
    const app = await build(t);
    await cleanDatabase(app);
    const subscriptions = app.mongo.db?.collection('subscription');

    const active = { site_id: 'rekry', status: SubscriptionStatus.ACTIVE, email_confirmed: true, lang: 'fi' };
    const targetId = await createSubscription(subscriptions, { ...active, atv_id: 'atv-a', email: '' });
    await createSubscription(subscriptions, { ...active, atv_id: 'atv-b', email: '' });

    // A full broadcast in progress must not block a test send.
    await app.mongo.db?.collection('queue').insertOne({
      type: 'broadcast',
      site_id: 'rekry',
      status: 'processing',
      test: false,
      created: new Date(),
      stats: null,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/broadcast',
      headers: { Authorization: 'api-key test' },
      payload: { ...validPayload, subscription_ids: [targetId.toString()] },
    });

    assert.strictEqual(res.statusCode, 202);
    const { id } = JSON.parse(res.body);

    const status = await waitForBroadcast(app, id);
    assert.strictEqual(status.status, 'completed');
    assert.strictEqual(status.test, true);
    assert.strictEqual(status.stats.subscriptionsChecked, 1);
    assert.strictEqual(status.stats.emailsQueued, 1);

    const queueItems = await app.mongo.db
      ?.collection('queue')
      .find({ type: { $in: ['email', 'sms'] } })
      .toArray();
    assert.strictEqual(queueItems?.length, 1);
    assert.strictEqual(queueItems?.[0].atv_id, 'atv-a');
  });

  test('broadcast status returns 404 for unknown and 400 for malformed ids', async (t) => {
    const app = await build(t);

    const notFound = await app.inject({
      method: 'GET',
      url: '/broadcast/000000000000000000000000',
      headers: { Authorization: 'api-key test' },
    });
    assert.strictEqual(notFound.statusCode, 404);

    const malformed = await app.inject({
      method: 'GET',
      url: '/broadcast/not-an-id',
      headers: { Authorization: 'api-key test' },
    });
    assert.strictEqual(malformed.statusCode, 400);
  });
});
