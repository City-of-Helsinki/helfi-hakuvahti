// Migration Script: Update subscription length for a specific site.
// This needs to be run to update ATV documents whenever subscription
// length is modified!
// --dry-run to preview changes to delete_after
// --batch-size to control batch size if ATV updates take longer than expected/crash

import { getAtvId } from '../lib/atvId';
import command, { type Server } from '../lib/command';
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader';
import atv from '../plugins/atv';
import mongodb from '../plugins/mongodb';

export interface MigrationOptions {
  siteId: string;
  batchSize: number;
  dryRun: boolean;
}

export interface MigrationStats {
  total: number;
  updated: number;
  failed: number;
  skipped: number;
}

/**
 * Formats a Date object to ISO date string (YYYY-MM-DD).
 *
 * @param date - The date to format
 * @return ISO date string (YYYY-MM-DD)
 */
export const formatDateISO = (date: Date): string => {
  return date.toISOString().substring(0, 10);
};

/**
 * Formats a subscription update log message.
 *
 * @param index - The subscription index in the current batch
 * @param subscriptionId - The MongoDB subscription ID
 * @param createdDate - The subscription creation date
 * @param deleteAfter - The calculated delete_after date
 * @param isDryRun - Whether this is a dry run
 * @return Formatted log message
 */
export const formatSubscriptionUpdateMessage = (
  index: number,
  subscriptionId: string,
  createdDate: Date,
  deleteAfter: Date,
  isDryRun: boolean,
): string => {
  const action = isDryRun ? '[DRY RUN] Would update' : 'Updated';
  const created = formatDateISO(createdDate);
  const deleteAfterStr = formatDateISO(deleteAfter);
  return `${index}. ${action}: ${subscriptionId} | Created: ${created} | New delete_after: ${deleteAfterStr}`;
};

/**
 * Formats an error message for a failed subscription update.
 *
 * @param index - The subscription index in the current batch
 * @param subscriptionId - The MongoDB subscription ID
 * @param error - The error that occurred
 * @return Formatted error message
 */
export const formatErrorMessage = (index: number, subscriptionId: string, error: unknown): string => {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  return `${index}. Failed: ${subscriptionId} | Error: ${errorMessage}`;
};

/**
 * Calculates the delete_after date for an ATV document based on subscription created date and maxAge.
 *
 * @param createdDate - The subscription creation date
 * @param maxAge - Number of days until deletion
 * @return The calculated delete_after date
 */
export const calculateDeleteAfterDate = (createdDate: Date, maxAge: number): Date => {
  const deleteAfter = new Date(createdDate);
  // setDate handles day/month overflow automatically so we can just get
  // current date and add X days to it.
  deleteAfter.setDate(deleteAfter.getDate() + maxAge);
  return deleteAfter;
};

/**
 * Updates ATV document delete_after timestamps for all subscriptions of a given site.
 *
 * @param server - Fastify server instance
 * @param options - Migration options
 */
export const updateSubscriptionLength = async (server: Server, options: MigrationOptions): Promise<void> => {
  const db = server.mongo.db;
  if (!db) {
    throw new Error('MongoDB connection not available');
  }

  const stats: MigrationStats = {
    total: 0,
    updated: 0,
    failed: 0,
    skipped: 0,
  };

  const collection = db.collection('subscription');
  const configLoader = SiteConfigurationLoader.getInstance();
  await configLoader.loadConfigurations();
  const siteConfig = configLoader.getConfiguration(options.siteId);

  if (!siteConfig) {
    throw new Error('Site configuration not found');
  }

  const maxAge = siteConfig.subscription.maxAge;
  console.log(`Site configuration maxAge = ${maxAge} days`);

  // Get all subscriptions
  const subscriptions = await collection.find({ site_id: options.siteId }).toArray();
  stats.total = subscriptions.length;

  console.log(`Found ${subscriptions.length} subscriptions for site: ${options.siteId}`);

  // Process subscriptions in batches
  const { batchSize, dryRun } = options;

  for (let i = 0; i < subscriptions.length; i += batchSize) {
    const batch = subscriptions.slice(i, i + batchSize);

    console.log(`\nbatch ${Math.floor(i / batchSize) + 1} (${batch.length} subscriptions):`);

    for (const [index, subscription] of batch.entries()) {
      try {
        // Calculate delete_after: subscription.created + maxAge days
        const createdDate = new Date(subscription.created);
        const deleteAfter = calculateDeleteAfterDate(createdDate, maxAge);

        const message = formatSubscriptionUpdateMessage(
          i + index + 1,
          subscription._id.toString(),
          createdDate,
          deleteAfter,
          dryRun,
        );

        console.log(message);

        if (!dryRun) {
          // Update ATV document with calculated delete_after
          await server.atvUpdateDocumentDeleteAfter(getAtvId(subscription), maxAge, createdDate);
        }

        stats.updated += 1;
      } catch (error) {
        const errorMessage = formatErrorMessage(i + index + 1, subscription._id.toString(), error);
        console.error(errorMessage);
        stats.failed += 1;
      }
    }
  }

  console.log(`Total: ${stats.total}`);
  console.log(`Updated: ${stats.updated}`);
  console.log(`Failed: ${stats.failed}`);
  console.log(`Skipped: ${stats.skipped}`);
};

command(
  async (server, argv) => {
    // Get site_id from --site parameter
    const siteId = argv.site as string;
    if (!siteId) {
      throw new Error('--site parameter is required');
    }

    const batchSize = (argv['batch-size'] as number) || 100;
    const dryRun = (argv['dry-run'] as boolean) || false;

    console.log(`Target site_id: ${siteId}`);
    console.log(`Batch size: ${batchSize}`);
    console.log(`Dry run: ${dryRun}`);
    console.log('');

    await updateSubscriptionLength(server, {
      siteId,
      batchSize,
      dryRun,
    });
  },
  [mongodb, atv],
);
