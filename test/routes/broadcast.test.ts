import * as assert from 'node:assert';
import { before, describe, mock, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { SubscriptionStatus } from '../../src/types/subscription.ts';
import {
  type AccessTokenOverrides,
  build,
  createSubscription,
  oidcProviderResponse,
  signAccessToken,
} from '../helper.ts';

// Contact details returned by the mocked ATV batch-list endpoint, by ATV id.
const atvDocs: Record<string, { email?: string; sms?: string }> = {
  'atv-a': { email: 'a@example.com' },
  'atv-b': { email: 'b@example.com' },
  'atv-b2': { email: 'b@example.com' },
};

const messages = {
  fi: { subject: 'Huoltokatko', body: 'FI body' },
  sv: { subject: 'Underhåll', body: 'SV body' },
  en: { subject: 'Maintenance', body: 'EN body' },
};

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    site_id: 'rekry',
    messages,
    ...overrides,
  };
}

async function cleanDatabase(app: FastifyInstance) {
  const db = app.mongo.db;
  await db?.collection('subscription').deleteMany({});
  await db?.collection('queue').deleteMany({});
}

/** Sends a broadcast with an access token an admin would have. */
async function broadcast(app: FastifyInstance, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/broadcast',
    headers: { Authorization: 'api-key test', 'X-Access-Token': await signAccessToken() },
    payload,
  });
}

/** Sends a broadcast with an access token built from the given overrides. */
async function broadcastWithToken(app: FastifyInstance, overrides: AccessTokenOverrides) {
  return app.inject({
    method: 'POST',
    url: '/broadcast',
    headers: { Authorization: 'api-key test', 'X-Access-Token': await signAccessToken(overrides) },
    payload: validPayload(),
  });
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
    mock.method(globalThis, 'fetch', async (url: string | URL, options?: { body?: string }) => {
      const target = url.toString();

      if (target.includes('/v1/documents/batch-list/')) {
        const { document_ids: ids } = JSON.parse(options?.body ?? '{}') as { document_ids: string[] };
        const docs = ids.filter((id) => atvDocs[id]).map((id) => ({ id, content: atvDocs[id] }));
        return new Response(JSON.stringify(docs), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // The signing keys the access tokens are verified against.
      const provider = oidcProviderResponse(target);

      if (provider) {
        return provider;
      }

      throw new Error(`Unexpected fetch URL: ${target}`);
    });
  });

  test('requires a valid api key', async (t) => {
    const app = await build(t);

    const res = await app.inject({
      method: 'POST',
      url: '/broadcast',
      headers: { Authorization: 'api-key wrong', 'X-Access-Token': await signAccessToken() },
      payload: validPayload(),
    });

    assert.strictEqual(res.statusCode, 403);
  });

  test('requires an access token', async (t) => {
    const app = await build(t);
    await cleanDatabase(app);

    const res = await app.inject({
      method: 'POST',
      url: '/broadcast',
      headers: { Authorization: 'api-key test' },
      payload: validPayload(),
    });

    assert.strictEqual(res.statusCode, 400);

    const queueItems = await app.mongo.db?.collection('queue').find({}).toArray();
    assert.strictEqual(queueItems?.length, 0);
  });

  test('rejects invalid input', async (t) => {
    const app = await build(t);
    await cleanDatabase(app);

    const testCases = [
      {
        name: 'invalid site_id',
        payload: validPayload({ site_id: 'nonexistent-site' }),
        expectedError: 'Invalid site_id',
      },
      {
        name: 'missing language',
        payload: validPayload({ messages: { fi: messages.fi, en: messages.en } }),
      },
      {
        name: 'empty subject',
        payload: validPayload({ messages: { ...messages, fi: { subject: '', body: 'FI body' } } }),
      },
      {
        name: 'SMS text for only one language',
        payload: validPayload({ messages: { ...messages, fi: { ...messages.fi, sms: 'FI sms' } } }),
        expectedError: 'SMS text must be provided',
      },
      {
        name: 'malformed subscription id',
        payload: validPayload({ subscription_ids: ['not-an-object-id'] }),
        expectedError: 'Invalid subscription id',
      },
      {
        name: 'empty subscription_ids array',
        payload: validPayload({ subscription_ids: [] }),
      },
      {
        name: 'missing site_id',
        payload: { messages },
      },
    ];

    for (const { name, payload, expectedError } of testCases) {
      await t.test(name, async () => {
        const res = await broadcast(app, payload);

        assert.strictEqual(res.statusCode, 400);

        if (expectedError) {
          const body = JSON.parse(res.body);
          assert.ok(body.error.includes(expectedError), `error should include "${expectedError}"`);
        }
      });
    }
  });

  test('rejects unacceptable access tokens', async (t) => {
    const app = await build(t);
    await cleanDatabase(app);

    const testCases: Array<{ name: string; overrides: AccessTokenOverrides }> = [
      {
        name: 'signed with an unknown key',
        overrides: { foreignKey: true },
      },
      {
        name: 'issued by another realm',
        overrides: { issuer: 'https://oidc.test/realms/somewhere-else' },
      },
      {
        name: 'expired',
        overrides: { expiresAt: Math.floor(Date.now() / 1000) - 60 },
      },
      {
        name: 'issued to a client that is not allowed to broadcast',
        overrides: { claims: { azp: 'some-other-client' } },
      },
      {
        name: 'without an azp claim',
        overrides: { claims: { azp: undefined } },
      },
      {
        name: 'an id token rather than an access token',
        overrides: { claims: { typ: 'ID' } },
      },
    ];

    for (const { name, overrides } of testCases) {
      await t.test(name, async () => {
        const res = await broadcastWithToken(app, overrides);

        assert.strictEqual(res.statusCode, 403);
        assert.ok(JSON.parse(res.body).error.includes('access token'));

        // Nothing was queued and no status record was created.
        const queueItems = await app.mongo.db?.collection('queue').find({}).toArray();
        assert.strictEqual(queueItems?.length, 0);
      });
    }
  });

  test('accepts a token without the non-standard typ claim', async (t) => {
    const app = await build(t);
    await cleanDatabase(app);

    const res = await broadcastWithToken(app, { claims: { typ: undefined } });

    assert.strictEqual(res.statusCode, 202);
    await waitForBroadcast(app, JSON.parse(res.body).id);
  });

  test('broadcasting is disabled without a configured issuer', async (t) => {
    const app = await build(t);
    await cleanDatabase(app);

    const issuer = process.env.OIDC_ISSUER;
    process.env.OIDC_ISSUER = '';

    try {
      const res = await broadcast(app, validPayload());

      // A misconfigured environment cannot broadcast, and the failure is ours
      // rather than the sender's.
      assert.strictEqual(res.statusCode, 500);

      const queueItems = await app.mongo.db?.collection('queue').find({}).toArray();
      assert.strictEqual(queueItems?.length, 0);
    } finally {
      process.env.OIDC_ISSUER = issuer;
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

    const res = await broadcast(app, validPayload());

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

    const res = await broadcast(app, validPayload());

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

    const res = await broadcast(app, validPayload());

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

    const res = await broadcast(app, validPayload({ subscription_ids: [targetId.toString()] }));

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
