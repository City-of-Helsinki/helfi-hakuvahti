// This file contains code that we reuse between our tests.

import assert from 'node:assert';
import crypto from 'node:crypto';
import type * as test from 'node:test';
import type { ObjectId } from '@fastify/mongodb';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { exportJWK, generateKeyPair, type JSONWebKeySet, SignJWT } from 'jose';
import type { Collection } from 'mongodb';
import app from '../src/app.ts';
import { SiteConfigurationLoader } from '../src/lib/siteConfigurationLoader.ts';
import type { SiteBroadcastSettingsType } from '../src/types/siteConfig.ts';
import { SubscriptionStatus } from '../src/types/subscription.ts';

export type TestContext = {
  after: typeof test.after;
};

process.env.HAKUVAHTI_API_KEY = 'test';

const OIDC_REALMS = 'https://oidc.test/realms/';

const DISCOVERY_PATH = '/.well-known/openid-configuration';
const CERTS_PATH = '/protocol/openid-connect/certs';

export const OIDC_ISSUER = `${OIDC_REALMS}hakuvahti`;
export const OIDC_DISCOVERY_URL = `${OIDC_ISSUER}${DISCOVERY_PATH}`;
export const OIDC_JWKS_URI = `${OIDC_ISSUER}${CERTS_PATH}`;
export const OIDC_CLIENT_ID = 'helfi-test';

/**
 * The AD group the signed tokens belong to.
 */
export const TEST_AD_GROUP_ID = '00000000-0000-4000-8000-0000000000a1';

const SIGNING_ALGORITHM = 'RS256';
const KEY_ID = 'test-key';

const { publicKey, privateKey } = await generateKeyPair(SIGNING_ALGORITHM, { extractable: true });

// A second key that the application does not know about, for signatures that
// must not be accepted.
const { privateKey: foreignPrivateKey } = await generateKeyPair(SIGNING_ALGORITHM, { extractable: true });

process.env.OIDC_ISSUER = OIDC_ISSUER;
process.env.OIDC_ALLOWED_CLIENTS = OIDC_CLIENT_ID;

/** The key set the stand-in provider publishes, i.e. what the tests sign with. */
export const OIDC_JWKS: JSONWebKeySet = {
  keys: [{ ...(await exportJWK(publicKey)), kid: KEY_ID, alg: SIGNING_ALGORITHM, use: 'sig' }],
};

/**
 * Answers the requests token verification makes to the identity provider, so
 * that no real one is reached.
 */
export function oidcProviderResponse(url: string): Response | undefined {
  if (!url.startsWith(OIDC_REALMS)) {
    return undefined;
  }

  if (url.endsWith(DISCOVERY_PATH)) {
    const issuer = url.slice(0, -DISCOVERY_PATH.length);

    return Response.json({ issuer, jwks_uri: `${issuer}${CERTS_PATH}` });
  }

  if (url.endsWith(CERTS_PATH)) {
    return Response.json(OIDC_JWKS);
  }

  return undefined;
}

export type AccessTokenOverrides = {
  issuer?: string;
  subject?: string;
  expiresAt?: number | string;
  claims?: Record<string, unknown>;
  /** Sign with a key the application does not trust. */
  foreignKey?: boolean;
};

/**
 * Creates an access token like the one Keycloak issues to a Drupal site.
 */
export function signAccessToken(overrides: AccessTokenOverrides = {}): Promise<string> {
  const {
    issuer = OIDC_ISSUER,
    subject = 'f5b1a0c2-0000-4000-8000-000000000001',
    expiresAt = '5m',
    claims = {},
    foreignKey = false,
  } = overrides;

  return new SignJWT({
    typ: 'Bearer',
    azp: OIDC_CLIENT_ID,
    email: 'admin@example.com',
    ad_groups: [TEST_AD_GROUP_ID],
    ...claims,
  })
    .setProtectedHeader({ alg: SIGNING_ALGORITHM, kid: KEY_ID })
    .setIssuer(issuer)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(foreignKey ? foreignPrivateKey : privateKey);
}

/**
 * Lets the tokens of signAccessToken broadcast for a site.
 *
 * @returns A function that restores the previous groups of the site.
 */
export function allowTestAdGroups(
  siteId: string,
  adGroups: SiteBroadcastSettingsType['adGroups'] = [TEST_AD_GROUP_ID],
): () => void {
  const siteConfig = SiteConfigurationLoader.getConfiguration(siteId);
  const previous = siteConfig.broadcast;

  siteConfig.broadcast = { adGroups };

  return () => {
    siteConfig.broadcast = previous;
  };
}

// Fill in this config with all the configurations
// needed for testing the application
function config() {
  return {};
}

/**
 * Helper for creating subscription in the database.
 *
 * @param collection - MongoDB collection to insert into
 * @param subscriptionData - Optional partial subscription data to override defaults
 * @returns The ObjectId of the created subscription
 */
export async function createSubscription(
  collection: Collection | undefined,
  subscriptionData: Partial<{
    hash: string;
    status: SubscriptionStatus;
    site_id: string;
    email: string;
    elastic_query: string;
    query: string;
    [key: string]: unknown;
  }> = {},
): Promise<ObjectId> {
  const insertResult = await collection?.insertOne({
    hash: crypto.randomUUID(),
    status: SubscriptionStatus.INACTIVE,
    site_id: 'test',
    email: 'test-atv-doc-id',
    atv_id: 'test-atv-doc-id',
    elastic_query: 'test-query',
    query: '/search?q=test',
    ...subscriptionData, // Override defaults with provided data
  });

  assert.ok(insertResult);

  return insertResult.insertedId;
}

// Automatically build and tear down our instance
async function build(t: TestContext): Promise<FastifyInstance> {
  const server = Fastify({ logger: { level: 'fatal' } });

  // Wrapping the app in fastify-plugin breaks encapsulation so that all
  // decorators are exposed for testing purposes; this is different from the
  // production setup, where the app is registered as its own context.
  // https://fastify.dev/docs/latest/Reference/Encapsulation/
  server.register(fp(app), config());

  // Tear down our app after we are done
  t.after(() => void server.close());

  await server.ready();

  return server;
}

export { config, build };
