import * as assert from 'node:assert';
import { after, before, beforeEach, describe, mock, test } from 'node:test';
import { BroadcastAuthError, resetKeyResolver, verifyBroadcastToken } from '../../src/lib/broadcastAuth.ts';
import {
  OIDC_CLIENT_ID,
  OIDC_DISCOVERY_URL,
  OIDC_ISSUER,
  OIDC_JWKS_URI,
  oidcProviderResponse,
  signAccessToken,
} from '../helper.ts';

/** How the stand-in provider answers the discovery request, when not the usual. */
let discovery: { status?: number; document?: unknown } = {};

/** The URLs the provider was asked for, in order. */
let requested: string[] = [];

// The identity provider is stood in for throughout, so that no real request is
// made and the discovery document can be broken on purpose.
before(() => {
  mock.method(globalThis, 'fetch', (input: string | URL | Request): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    requested.push(url);

    if (url === OIDC_DISCOVERY_URL) {
      if (discovery.status !== undefined) {
        return Promise.resolve(new Response('', { status: discovery.status }));
      }

      if (discovery.document !== undefined) {
        return Promise.resolve(Response.json(discovery.document));
      }
    }

    const response = oidcProviderResponse(url);

    return response ? Promise.resolve(response) : Promise.reject(new Error(`Unexpected request to ${url}.`));
  });
});

after(() => mock.restoreAll());

// Every test discovers the keys for itself, so that what was requested can be
// asserted on and a broken discovery document does not leak into the next test.
beforeEach(() => {
  discovery = {};
  requested = [];
  resetKeyResolver();
});

/** Runs a test with an OIDC environment variable temporarily changed. */
async function withEnvironment(name: string, value: string | undefined, run: () => Promise<void>) {
  const original = process.env[name];

  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  resetKeyResolver();

  try {
    await run();
  } finally {
    if (original === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = original;
    }
    resetKeyResolver();
  }
}

describe('verifyBroadcastToken', () => {
  test('returns who sent the broadcast', async () => {
    const sender = await verifyBroadcastToken(
      await signAccessToken({ subject: 'sub-1', claims: { email: 'admin@example.com' } }),
    );

    assert.deepStrictEqual(sender, {
      sub: 'sub-1',
      azp: OIDC_CLIENT_ID,
      email: 'admin@example.com',
    });
  });

  test('accepts any of the allowed clients', async () => {
    await withEnvironment('OIDC_ALLOWED_CLIENTS', ` other-client , ${OIDC_CLIENT_ID} `, async () => {
      const sender = await verifyBroadcastToken(await signAccessToken());

      assert.strictEqual(sender.azp, OIDC_CLIENT_ID);
    });
  });

  test('rejects a missing/invalid token', async () => {
    await assert.rejects(() => verifyBroadcastToken(undefined), BroadcastAuthError);
    await assert.rejects(() => verifyBroadcastToken(''), BroadcastAuthError);
    await assert.rejects(() => verifyBroadcastToken('not-a-token'), BroadcastAuthError);
  });

  test('rejects a token without a sub claim', async () => {
    // Passing an empty subject leaves the claim out of the payload.
    const token = await signAccessToken({ subject: '' });

    await assert.rejects(() => verifyBroadcastToken(token), BroadcastAuthError);
  });

  // A configuration problem is ours, not the sender's, so it must not look like
  // a rejected token: the route turns those into a 403 and everything else into
  // a 500.
  test('a missing issuer is not reported as a rejected token', async () => {
    const token = await signAccessToken();

    await withEnvironment('OIDC_ISSUER', undefined, async () => {
      await assert.rejects(
        () => verifyBroadcastToken(token),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(!(error instanceof BroadcastAuthError));
          assert.match(error.message, /OIDC_ISSUER is not set/);
          return true;
        },
      );
    });
  });

  test('finds the signing keys through the discovery document', async () => {
    const token = await signAccessToken();

    const sender = await verifyBroadcastToken(token);

    assert.strictEqual(sender.azp, OIDC_CLIENT_ID);

    // The document is only read once, and the keys behind it are cached by the
    // resolver, so a second broadcast makes no request at all.
    await verifyBroadcastToken(token);

    assert.deepStrictEqual(requested, [OIDC_DISCOVERY_URL, OIDC_JWKS_URI]);
  });

  test('a discovery document for another issuer is not reported as a rejected token', async () => {
    discovery = { document: { issuer: 'https://oidc.test/realms/other', jwks_uri: OIDC_JWKS_URI } };
    const token = await signAccessToken();

    await assert.rejects(
      () => verifyBroadcastToken(token),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!(error instanceof BroadcastAuthError));
        assert.match(error.message, /is for issuer "https:\/\/oidc.test\/realms\/other"/);
        return true;
      },
    );
  });

  test('a discovery document without a jwks_uri is not reported as a rejected token', async () => {
    discovery = { document: { issuer: OIDC_ISSUER } };
    const token = await signAccessToken();

    await assert.rejects(
      () => verifyBroadcastToken(token),
      (error: unknown) => {
        assert.ok(!(error instanceof BroadcastAuthError));
        assert.match((error as Error).message, /has no jwks_uri/);
        return true;
      },
    );
  });

  // Otherwise a provider that is briefly unreachable would keep broadcasting
  // broken until the service is restarted.
  test('a failed discovery is not remembered, and broadcasting recovers on its own', async () => {
    discovery = { status: 503 };
    const token = await signAccessToken();

    await assert.rejects(
      () => verifyBroadcastToken(token),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!(error instanceof BroadcastAuthError));
        assert.match(error.message, /responded 503/);
        return true;
      },
    );

    // Every attempt asks again rather than serving the remembered failure.
    await assert.rejects(() => verifyBroadcastToken(token));

    assert.deepStrictEqual(requested, [OIDC_DISCOVERY_URL, OIDC_DISCOVERY_URL]);

    // The provider comes back, and the next broadcast goes through without the
    // service having been restarted.
    discovery = {};

    const sender = await verifyBroadcastToken(token);

    assert.strictEqual(sender.azp, OIDC_CLIENT_ID);
    assert.deepStrictEqual(requested, [OIDC_DISCOVERY_URL, OIDC_DISCOVERY_URL, OIDC_DISCOVERY_URL, OIDC_JWKS_URI]);

    // That success is remembered, so the recovered provider is not asked again.
    await verifyBroadcastToken(token);

    assert.strictEqual(requested.length, 4);
  });

  test('verifies against the issuer configured at the time of the request', async () => {
    const token = await signAccessToken({ issuer: 'https://oidc.test/realms/other' });

    await assert.rejects(() => verifyBroadcastToken(token), BroadcastAuthError);

    await withEnvironment('OIDC_ISSUER', 'https://oidc.test/realms/other', async () => {
      const sender = await verifyBroadcastToken(token);

      assert.strictEqual(sender.azp, OIDC_CLIENT_ID);
    });

    // The original issuer still works afterwards.
    assert.strictEqual(process.env.OIDC_ISSUER, OIDC_ISSUER);
  });
});
