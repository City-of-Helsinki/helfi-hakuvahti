import * as assert from 'node:assert';
import { before, describe, mock, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { MAX_FAILED_ATTEMPTS, resetFailedAttempts } from '../../src/lib/broadcastAuth.ts';
import { SiteConfigurationLoader } from '../../src/lib/siteConfigurationLoader.ts';
import { decodeBase32, generateTotp, TOTP_STEP_MS } from '../../src/lib/totp.ts';
import { SubscriptionStatus } from '../../src/types/subscription.ts';
import { build, createSubscription } from '../helper.ts';

// Contact details returned by the mocked ATV batch-list endpoint, by ATV id.
const atvDocs: Record<string, { email?: string; sms?: string }> = {
  'atv-a': { email: 'a@example.com' },
  'atv-b': { email: 'b@example.com' },
  'atv-b2': { email: 'b@example.com' },
};

// Base32 of the RFC 6238 test secret "12345678901234567890".
process.env.BROADCAST_TOTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

/** Code an admin with the secret in their authenticator app would see now. */
function currentCode(): string {
  return generateTotp(decodeBase32(process.env.BROADCAST_TOTP_SECRET ?? ''), Math.floor(Date.now() / TOTP_STEP_MS));
}

const messages = {
  fi: { subject: 'Huoltokatko', body: 'FI body' },
  sv: { subject: 'Underhåll', body: 'SV body' },
  en: { subject: 'Maintenance', body: 'EN body' },
};

/** A payload with a freshly generated verification code. */
function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    site_id: 'rekry',
    totp_code: currentCode(),
    messages,
    ...overrides,
  };
}

async function cleanDatabase(app: FastifyInstance) {
  const db = app.mongo.db;
  await db?.collection('subscription').deleteMany({});
  await db?.collection('queue').deleteMany({});
  // The failed code counter lives in the process, not in the database.
  resetFailedAttempts();
}

function broadcast(app: FastifyInstance, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/broadcast',
    headers: { Authorization: 'api-key test' },
    payload,
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
      payload: validPayload(),
    });

    assert.strictEqual(res.statusCode, 403);
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
        name: 'missing verification code',
        payload: { site_id: 'rekry', messages },
      },
      {
        name: 'too short verification code',
        payload: validPayload({ totp_code: '12345' }),
      },
      {
        name: 'non-numeric verification code',
        payload: validPayload({ totp_code: 'abcdef' }),
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

  test('rejects a wrong verification code', async (t) => {
    const app = await build(t);
    await cleanDatabase(app);

    const res = await broadcast(app, validPayload({ totp_code: '000000' }));

    assert.strictEqual(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.ok(body.error.includes('Invalid verification code'));

    // Nothing was queued and no status record was created.
    const queueItems = await app.mongo.db?.collection('queue').find({}).toArray();
    assert.strictEqual(queueItems?.length, 0);
  });

  test('locks broadcasting after repeated wrong verification codes', async (t) => {
    const app = await build(t);
    await cleanDatabase(app);

    for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt++) {
      const res = await broadcast(app, validPayload({ totp_code: '000000' }));
      assert.strictEqual(res.statusCode, 403, `attempt ${attempt} should be rejected but not lock`);
    }

    const locking = await broadcast(app, validPayload({ totp_code: '000000' }));
    assert.strictEqual(locking.statusCode, 423);
    assert.ok(JSON.parse(locking.body).error.includes('locked'));

    // Every site is blocked, not just the one that was targeted.
    const lockRecords = await app.mongo.db?.collection('queue').find({ type: 'broadcast', auth_lock: true }).toArray();
    assert.strictEqual(lockRecords?.length, SiteConfigurationLoader.getSiteIds().length);
    assert.deepStrictEqual(
      lockRecords?.map((record) => record.site_id).sort(),
      [...SiteConfigurationLoader.getSiteIds()].sort(),
    );

    // A valid code no longer helps.
    const withValidCode = await broadcast(app, validPayload());
    assert.strictEqual(withValidCode.statusCode, 423);

    // Test sends bypass the normal double submission guard, but not the lock.
    const subscriptions = app.mongo.db?.collection('subscription');
    const targetId = await createSubscription(subscriptions, {
      site_id: 'rekry',
      status: SubscriptionStatus.ACTIVE,
      email_confirmed: true,
      lang: 'fi',
      atv_id: 'atv-a',
      email: '',
    });
    const testSend = await broadcast(app, validPayload({ subscription_ids: [targetId.toString()] }));
    assert.strictEqual(testSend.statusCode, 423);

    const queueItems = await app.mongo.db
      ?.collection('queue')
      .find({ type: { $in: ['email', 'sms'] } })
      .toArray();
    assert.strictEqual(queueItems?.length, 0);
  });

  test('a stale lock no longer blocks broadcasting', async (t) => {
    const app = await build(t);
    await cleanDatabase(app);

    await app.mongo.db?.collection('queue').insertOne({
      type: 'broadcast',
      site_id: 'rekry',
      status: 'processing',
      test: false,
      created: new Date(Date.now() - 31 * 60 * 1000),
      stats: null,
      auth_lock: true,
    });

    const res = await broadcast(app, validPayload());

    assert.strictEqual(res.statusCode, 202);
    await waitForBroadcast(app, JSON.parse(res.body).id);
  });

  test('a valid code clears the failed attempt count', async (t) => {
    const app = await build(t);
    await cleanDatabase(app);

    for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt++) {
      const res = await broadcast(app, validPayload({ totp_code: '000000' }));
      assert.strictEqual(res.statusCode, 403);
    }

    const accepted = await broadcast(app, validPayload());
    assert.strictEqual(accepted.statusCode, 202);
    await waitForBroadcast(app, JSON.parse(accepted.body).id);

    // The counter started over, so the same number of failures does not lock.
    for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt++) {
      const res = await broadcast(app, validPayload({ totp_code: '000000' }));
      assert.strictEqual(res.statusCode, 403, `attempt ${attempt} should not lock after a valid code`);
    }

    const lockRecord = await app.mongo.db?.collection('queue').findOne({ type: 'broadcast', auth_lock: true });
    assert.strictEqual(lockRecord, null);
  });

  test('broadcasting is disabled without a configured secret', async (t) => {
    const app = await build(t);
    await cleanDatabase(app);

    const secret = process.env.BROADCAST_TOTP_SECRET;
    // Build the payload while the secret is still available: even a valid
    // code must be rejected once the secret is gone.
    const payload = validPayload();
    process.env.BROADCAST_TOTP_SECRET = '';

    try {
      const res = await broadcast(app, payload);

      assert.strictEqual(res.statusCode, 500);

      // Nothing was queued: a misconfigured environment cannot broadcast.
      const queueItems = await app.mongo.db?.collection('queue').find({}).toArray();
      assert.strictEqual(queueItems?.length, 0);
    } finally {
      process.env.BROADCAST_TOTP_SECRET = secret;
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
