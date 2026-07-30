import * as Sentry from '@sentry/node';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';
import { type BroadcastStatusDocument, PROCESSING_STALE_MS } from '../types/broadcast.ts';
import { SiteConfigurationLoader } from './siteConfigurationLoader.ts';
import { decodeBase32, TOTP_STEP_MS, verifyTotp } from './totp.ts';

/**
 * Second factor for the broadcast endpoint.
 *
 * Broadcasting reaches every subscriber of a site, so we must take extra care
 * to protect the endpoint: the admin must also pass valid TOPT code with the request.
 */

/** Consecutive invalid codes that block broadcasting. */
export const MAX_FAILED_ATTEMPTS = 5;

/**
 * Consecutive invalid codes seen by this process.
 *
 * With several replicas an attacker gets MAX_FAILED_ATTEMPTS per replica.
 * The ban itself is stored in MongoDB so one failure in any replica
 * blocks future attempts.
 */
let failedAttempts = 0;

/**
 * Verify a broadcast code against BROADCAST_TOTP_SECRET.
 */
export function verifyBroadcastCode(code: string): boolean {
  const secret = process.env.BROADCAST_TOTP_SECRET;

  if (!secret) {
    throw new Error('BROADCAST_TOTP_SECRET is not set.');
  }

  return verifyTotp(decodeBase32(secret), code, Math.floor(Date.now() / TOTP_STEP_MS));
}

/**
 * Count an invalid code.
 */
export function registerFailedAttempt(): boolean {
  failedAttempts += 1;

  if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
    failedAttempts = 0;
    return true;
  }

  return false;
}

/** Only consecutive failures count, so a valid code clears the counter. */
export function resetFailedAttempts(): void {
  failedAttempts = 0;
}

/**
 * Block broadcasting for every site and report it to Sentry.
 */
export async function blockBroadcasts(db: Db, log: FastifyBaseLogger): Promise<void> {
  const created = new Date();
  const records: BroadcastStatusDocument[] = SiteConfigurationLoader.getSiteIds().map((siteId) => ({
    type: 'broadcast',
    site_id: siteId,
    status: 'processing',
    test: false,
    created,
    stats: null,
    auth_lock: true,
  }));

  await db.collection<BroadcastStatusDocument>('queue').insertMany(records, { ordered: false });

  const message = `Broadcast API blocked after ${MAX_FAILED_ATTEMPTS} invalid verification codes.`;

  log.error(message);
  Sentry.captureMessage(message, 'error');
}

/** True while broadcasting is blocked by repeated invalid codes. */
export async function isBroadcastBlocked(db: Db): Promise<boolean> {
  const record = await db.collection<BroadcastStatusDocument>('queue').findOne({
    type: 'broadcast',
    auth_lock: true,
    created: { $gt: new Date(Date.now() - PROCESSING_STALE_MS) },
  });

  return record !== null;
}
