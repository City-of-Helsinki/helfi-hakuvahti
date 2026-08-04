import * as assert from 'node:assert';
import { after, before, beforeEach, describe, mock, test } from 'node:test';
import {
  authorizeBroadcastSender,
  BroadcastAuthError,
  type BroadcastSender,
  resetKeyResolver,
  verifyBroadcastToken,
} from '../../src/lib/broadcastAuth.ts';
import type { SiteBroadcastSettingsType, SiteConfigurationType } from '../../src/types/siteConfig.ts';
import {
  OIDC_CLIENT_ID,
  OIDC_DISCOVERY_URL,
  OIDC_ISSUER,
  OIDC_JWKS_URI,
  oidcProviderResponse,
  signAccessToken,
  TEST_AD_GROUP_ID,
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
      adGroups: [TEST_AD_GROUP_ID],
    });
  });

  test('reads the AD groups of the token, ignoring what is not a group id', async () => {
    const sender = await verifyBroadcastToken(
      await signAccessToken({ claims: { ad_groups: ['group-a', '', 42, null, 'group-b'] } }),
    );

    assert.deepStrictEqual(sender.adGroups, ['group-a', 'group-b']);
  });

  // Which groups are needed depends on the site being broadcast to, which is not
  // known here, so this is left to authorizeBroadcastSender.
  test('a token without AD groups is verified with an empty group list', async () => {
    const missing = await verifyBroadcastToken(await signAccessToken({ claims: { ad_groups: undefined } }));
    assert.deepStrictEqual(missing.adGroups, []);

    const notAList = await verifyBroadcastToken(await signAccessToken({ claims: { ad_groups: 'group-a' } }));
    assert.deepStrictEqual(notAList.adGroups, []);
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

describe('authorizeBroadcastSender', () => {
  /** Only the parts of a site configuration that authorization looks at. */
  function siteConfiguration(broadcast?: SiteBroadcastSettingsType): SiteConfigurationType {
    return {
      id: 'rekry',
      name: 'rekry',
      urls: { base: '', en: '', fi: '', sv: '' },
      subscription: { maxAge: 90, unconfirmedMaxAge: 5, expiryNotificationDays: 3 },
      mail: { templatePath: 'rekry' },
      elasticProxyUrl: '',
      matchField: 'field_publication_starts',
      broadcast,
    };
  }

  function sender(adGroups: string[]): BroadcastSender {
    return { sub: 'sub-1', azp: OIDC_CLIENT_ID, adGroups };
  }

  const allowed = siteConfiguration({ adGroups: [TEST_AD_GROUP_ID] });

  test('names the group that let the broadcast through', () => {
    assert.strictEqual(authorizeBroadcastSender(sender([TEST_AD_GROUP_ID]), allowed), TEST_AD_GROUP_ID);
  });

  test('one of the many groups of a Helsinki employee is enough', () => {
    const many = ['group-a', 'group-b', TEST_AD_GROUP_ID, 'group-c'];

    assert.strictEqual(authorizeBroadcastSender(sender(many), allowed), TEST_AD_GROUP_ID);
  });

  // The claim carries group names for a Helsinki AD account but object ids for a
  // consultant account, whose groups are not mapped to names, so a group is
  // listed in both forms and either has to be accepted.
  test('matches a group by name or by object id, whichever the claim carries', () => {
    const site = siteConfiguration({
      adGroups: ['Drupal_Helfi_kaupunkitaso_paakayttajat', '947058f4-697e-41bb-baf5-f69b49e5579a'],
    });

    // A Helsinki AD account.
    assert.strictEqual(
      authorizeBroadcastSender(sender(['Drupal_Helfi_jokumuu', 'Drupal_Helfi_kaupunkitaso_paakayttajat']), site),
      'Drupal_Helfi_kaupunkitaso_paakayttajat',
    );

    // A consultant account, whose groups arrive unmapped.
    assert.strictEqual(
      authorizeBroadcastSender(
        sender(['0432ec41-c302-4072-a439-e675f112764d', '947058f4-697e-41bb-baf5-f69b49e5579a']),
        site,
      ),
      '947058f4-697e-41bb-baf5-f69b49e5579a',
    );
  });

  test('rejects a sender who is in none of the groups of the site', () => {
    assert.throws(
      () => authorizeBroadcastSender(sender(['group-a', 'group-b']), allowed),
      (error: unknown) => {
        assert.ok(error instanceof BroadcastAuthError);
        assert.match((error as Error).message, /not a member of any group allowed to broadcast for "rekry"/);
        return true;
      },
    );
  });

  // The likely first failure while setting the Drupal side up, so the reason has
  // to name the scope rather than look like a missing permission.
  test('rejects a token without AD groups, naming the missing claim', () => {
    assert.throws(
      () => authorizeBroadcastSender(sender([]), allowed),
      (error: unknown) => {
        assert.ok(error instanceof BroadcastAuthError);
        assert.match((error as Error).message, /add-ad-groups-claim/);
        return true;
      },
    );
  });

  // A site nobody is allowed to broadcast for is our missing configuration, and
  // the route turns anything that is not a BroadcastAuthError into a 500. If it
  // were a 403 instead, a forgotten config would read as a permission problem.
  test('a site without configured groups is not reported as a rejected sender', () => {
    for (const broadcast of [undefined, { adGroups: [] }, { adGroups: [''] }]) {
      assert.throws(
        () => authorizeBroadcastSender(sender([TEST_AD_GROUP_ID]), siteConfiguration(broadcast)),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(!(error instanceof BroadcastAuthError));
          assert.match(error.message, /has no broadcast.adGroups configured/);
          return true;
        },
      );
    }
  });
});
