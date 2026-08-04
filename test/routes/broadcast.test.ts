import * as assert from 'node:assert';
import { before, describe, mock, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { SubscriptionStatus } from '../../src/types/subscription.ts';
import {
  type AccessTokenOverrides,
  allowTestAdGroups,
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

/**
 * Waits until the background fan-out has queued the expected notifications.
 */
async function waitForQueue(app: FastifyInstance, expected: number) {
  for (let i = 0; i < 100; i++) {
    const queued = await app.mongo.db?.collection('queue').countDocuments({});

    if (queued === expected) {
      return;
    }

    await sleep(50);
  }
  assert.fail(`Broadcast did not queue ${expected} notification(s) in time.`);
}

describe('/broadcast', () => {
  before(() => {
    // Which AD groups may broadcast is deployment configuration, so the tokens
    // the tests sign are granted the group here rather than in conf/.
    allowTestAdGroups('rekry');

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

        // Nothing was queued.
        const queueItems = await app.mongo.db?.collection('queue').find({}).toArray();
        assert.strictEqual(queueItems?.length, 0);
      });
    }
  });

  test('accepts a token without the non-standard typ claim', async (t) => {
    const app = await build(t);
    await cleanDatabase(app);
    const subscriptions = app.mongo.db?.collection('subscription');

    // One subscriber, so that the fan-out has a concrete finishing point.
    await createSubscription(subscriptions, {
      site_id: 'rekry',
      status: SubscriptionStatus.ACTIVE,
      email_confirmed: true,
      lang: 'fi',
      atv_id: 'atv-a',
      email: '',
    });

    const res = await broadcastWithToken(app, { claims: { typ: undefined } });

    assert.strictEqual(res.statusCode, 202);
    await waitForQueue(app, 1);
  });

  test('rejects a sender who is not in an AD group of the site', async (t) => {
    const app = await build(t);
    await cleanDatabase(app);

    const testCases: Array<{ name: string; overrides: AccessTokenOverrides }> = [
      {
        name: 'in other AD groups than the site allows',
        overrides: { claims: { ad_groups: ['some-other-group'] } },
      },
      {
        // A client without the add-ad-groups-claim scope looks like this.
        name: 'without the ad_groups claim',
        overrides: { claims: { ad_groups: undefined } },
      },
    ];

    for (const { name, overrides } of testCases) {
      await t.test(name, async () => {
        const res = await broadcastWithToken(app, overrides);

        // A valid token of a known client, so this is about the permission
        // rather than the token itself.
        assert.strictEqual(res.statusCode, 403);
        assert.strictEqual(JSON.parse(res.body).error, 'Not authorized to broadcast for this site.');

        const queueItems = await app.mongo.db?.collection('queue').find({}).toArray();
        assert.strictEqual(queueItems?.length, 0);
      });
    }
  });

  test('broadcasting a site without configured AD groups is disabled', async (t) => {
    const app = await build(t);
    await cleanDatabase(app);

    const restore = allowTestAdGroups('rekry', []);

    try {
      const res = await broadcast(app, validPayload());

      // Nobody being allowed is a forgotten configuration, not a sender without
      // a permission, so it fails closed as ours rather than as a 403.
      assert.strictEqual(res.statusCode, 500);

      const queueItems = await app.mongo.db?.collection('queue').find({}).toArray();
      assert.strictEqual(queueItems?.length, 0);
    } finally {
      restore();
    }
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

    // A 202 carries no body: nothing reports back on a broadcast any more.
    assert.strictEqual(res.statusCode, 202);
    assert.strictEqual(res.body, '');

    // Two of the three subscriptions of the site, the third deduplicated away.
    await waitForQueue(app, 2);

    const queueItems = await app.mongo.db?.collection('queue').find({}).toArray();
    assert.strictEqual(queueItems?.length, 2);
    const fiItem = queueItems?.find((item) => item.atv_id === 'atv-a');
    assert.ok(fiItem?.content.includes('<title>Huoltokatko</title>'));
    assert.ok(fiItem?.content.includes('FI body'));
  });

  test('test mode sends only to the given subscriptions', async (t) => {
    const app = await build(t);
    await cleanDatabase(app);
    const subscriptions = app.mongo.db?.collection('subscription');

    const active = { site_id: 'rekry', status: SubscriptionStatus.ACTIVE, email_confirmed: true, lang: 'fi' };
    const targetId = await createSubscription(subscriptions, { ...active, atv_id: 'atv-a', email: '' });
    await createSubscription(subscriptions, { ...active, atv_id: 'atv-b', email: '' });

    const res = await broadcast(app, validPayload({ subscription_ids: [targetId.toString()] }));

    assert.strictEqual(res.statusCode, 202);

    // Only the targeted subscription, not the other subscriber of the site.
    await waitForQueue(app, 1);

    const queueItems = await app.mongo.db?.collection('queue').find({}).toArray();
    assert.strictEqual(queueItems?.length, 1);
    assert.strictEqual(queueItems?.[0].atv_id, 'atv-a');
  });
});
