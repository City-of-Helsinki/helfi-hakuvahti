import {createRemoteJWKSet, type JWTPayload, jwtVerify, type JWTVerifyGetKey} from 'jose';

/**
 * Authorization for the broadcast endpoint.
 *
 * Broadcasting reaches every subscriber of a site, so we must take extra care to
 * protect the endpoint.
 *  - The api key says the Drupal site is authorized to call Hakuvahti API.
 *  - OpenID Connect access token determines that the AD user is allowed to broadcast.
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
  };
}

function getStringClaim(payload: JWTPayload, claim: string): string {
  const value = payload[claim];

  if (typeof value !== 'string' || value === '') {
    throw new BroadcastAuthError(`The token has no ${claim} claim.`);
  }

  return value;
}
