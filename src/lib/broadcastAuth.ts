import { createRemoteJWKSet, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from 'jose';
import type { SiteConfigurationType } from '../types/siteConfig.ts';

/**
 * Authorization for the broadcast endpoint.
 *
 * Broadcasting reaches every subscriber of a site, so we must take extra care to
 * protect the endpoint. Three separate things have to hold:
 *  - The api key says the Drupal site is authorized to call Hakuvahti API.
 *  - The OpenID Connect access token identifies an AD user who logged in to one
 *    of the clients in OIDC_ALLOWED_CLIENTS.
 *  - The token's ad_groups claim names a group that the target site allows to
 *    broadcast for it, see broadcast.adGroups in conf/{site}.json.
 */

/**
 * Thrown when a token is not acceptable.
 */
export class BroadcastAuthError extends Error {}

/** A verified broadcast sender. */
export interface BroadcastSender {
  /** Identity provider's subject identifier. */
  sub: string;
  /** Client id of the Drupal site the broadcast came from. */
  azp: string;
  email?: string;
  /** The AD groups of the token's ad_groups claim. */
  adGroups: string[];
}

/** Tolerance in seconds for clock differences between us and the provider. */
const CLOCK_TOLERANCE = 5;

/** How long we wait for the provider's discovery document. */
const DISCOVERY_TIMEOUT_MS = 10000;

type KeyResolver = JWTVerifyGetKey;

/** Cached per issuer, since the discovery document belongs to the issuer. */
const keyResolvers = new Map<string, Promise<KeyResolver>>();

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set.`);
  }

  return value;
}

interface BroadcastAuthConfiguration {
  issuer: string;
  allowedClients: string[];
}

/**
 * The configuration broadcasting is authorized against.
 */
function readConfiguration(): BroadcastAuthConfiguration {
  const issuer = requireEnvironmentVariable('OIDC_ISSUER');
  const allowedClients = requireEnvironmentVariable('OIDC_ALLOWED_CLIENTS')
    .split(',')
    .map((client) => client.trim())
    .filter(Boolean);

  if (allowedClients.length === 0) {
    throw new Error('OIDC_ALLOWED_CLIENTS does not contain any client ids.');
  }

  return { issuer, allowedClients };
}

/**
 * Reads the JWKS URI off the issuer's OpenID Connect discovery document.
 */
async function discoverJwksUri(issuer: string): Promise<URL> {
  // Per OpenID Connect Discovery the path is appended to the issuer, which for
  // a Keycloak realm already has one.
  const discoveryUrl = new URL(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);

  const response = await fetch(discoveryUrl, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`${discoveryUrl.toString()} responded ${response.status}.`);
  }

  const document = (await response.json()) as { issuer?: unknown; jwks_uri?: unknown };

  // The document must name the issuer we asked about. Anything else means we are
  // not talking to the provider we think we are.
  if (document.issuer !== issuer) {
    throw new Error(`${discoveryUrl.toString()} is for issuer "${String(document.issuer)}", expected "${issuer}".`);
  }

  if (typeof document.jwks_uri !== 'string' || document.jwks_uri === '') {
    throw new Error(`${discoveryUrl.toString()} has no jwks_uri.`);
  }

  return new URL(document.jwks_uri);
}

/**
 * Resolves the keys access tokens are verified against.
 */
function getKeyResolver(issuer: string): Promise<KeyResolver> {
  const known = keyResolvers.get(issuer);

  if (known) {
    return known;
  }

  const resolver = discoverJwksUri(issuer).then((jwksUri) => createRemoteJWKSet(jwksUri));

  // A failed discovery must not be remembered.
  const cached: Promise<KeyResolver> = resolver.catch((error: unknown) => {
    if (keyResolvers.get(issuer) === cached) {
      keyResolvers.delete(issuer);
    }

    throw error;
  });

  keyResolvers.set(issuer, cached);

  return cached;
}

/** Forgets the cached key resolvers. */
export function resetKeyResolver(): void {
  keyResolvers.clear();
}

/**
 * Verifies the access token of the admin sending a broadcast.
 */
export async function verifyBroadcastToken(token: string | undefined): Promise<BroadcastSender> {
  const { issuer, allowedClients } = readConfiguration();

  if (!token) {
    throw new BroadcastAuthError('The request has no access token.');
  }

  const resolveKey = await getKeyResolver(issuer);

  let payload: JWTPayload;
  try {
    // Verifies the signature and the exp and iss claims. A failure to fetch the
    // keys also ends up here; the logged reason tells the two apart.
    ({ payload } = await jwtVerify(token, resolveKey, { issuer, clockTolerance: CLOCK_TOLERANCE }));
  } catch (error) {
    throw new BroadcastAuthError(error instanceof Error ? error.message : 'The access token is not valid.');
  }

  // Access tokens are marked as Bearer. This check should forbid id tokens.
  if (typeof payload.typ === 'string' && payload.typ !== 'Bearer') {
    throw new BroadcastAuthError(`Expected a Bearer token, got "${payload.typ}".`);
  }

  const azp = getStringClaim(payload, 'azp');

  if (!allowedClients.includes(azp)) {
    throw new BroadcastAuthError(`The token was issued to "${azp}", which is not an allowed client.`);
  }

  return {
    sub: getStringClaim(payload, 'sub'),
    azp,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    adGroups: getAdGroups(payload),
  };
}

/**
 * Checks that the sender belongs to a group the site lets broadcast for it.
 *
 * Verifying the token only says who the sender is. This is what says they are
 * allowed to reach the subscribers of this particular site.
 *
 * @returns The group that matched.
 */
export function authorizeBroadcastSender(sender: BroadcastSender, siteConfig: SiteConfigurationType): string {
  const configured = (siteConfig.broadcast?.adGroups ?? []).filter(
    (group) => typeof group === 'string' && group !== '',
  );

  // Checked before the sender, since our own missing configuration must not be
  // reported as the sender lacking a permission.
  if (configured.length === 0) {
    throw new Error(`Site "${siteConfig.id}" has no broadcast.adGroups configured, so broadcasting to it is disabled.`);
  }

  if (sender.adGroups.length === 0) {
    throw new BroadcastAuthError(
      'The token has no ad_groups claim. The client is likely missing the add-ad-groups-claim scope.',
    );
  }

  const membership = new Set(sender.adGroups);
  const match = configured.find((group) => membership.has(group));

  if (match === undefined) {
    throw new BroadcastAuthError(
      `Sub ${sender.sub} is not a member of any group allowed to broadcast for "${siteConfig.id}".`,
    );
  }

  return match;
}

function getStringClaim(payload: JWTPayload, claim: string): string {
  const value = payload[claim];

  if (typeof value !== 'string' || value === '') {
    throw new BroadcastAuthError(`The token has no ${claim} claim.`);
  }

  return value;
}

/**
 * The AD groups of the token, however the provider named them.
 *
 * Missing or malformed is an empty list rather than an error: whether groups are
 * needed at all is up to the site being broadcast to, which is not known here.
 */
function getAdGroups(payload: JWTPayload): string[] {
  if (!Array.isArray(payload.ad_groups)) {
    return [];
  }

  return payload.ad_groups.filter((group): group is string => typeof group === 'string' && group !== '');
}
