// Migration Script: Update subscription length for a specific site.
// This needs to be run to update ATV documents whenever subscription
// length is modified!
// --dry-run to preview changes to delete_after
// --batch-size to control batch size if ATV updates take longer than expected/crash

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
 * Parses command line arguments for the migration script.
 *
 * @param args - Command line arguments (process.argv.slice(2))
 * @return Parsed migration options
 */
export const parseArguments = (args: string[]): Omit<MigrationOptions, 'siteId'> & { siteId: string | undefined } => {
  const batchSize = Number.parseInt(args.find((arg) => arg.startsWith('--batch-size='))?.split('=')[1] || '100', 10);
  const dryRun = args.includes('--dry-run');
  const siteId = args.find((arg) => arg.startsWith('--site='))?.split('=')[1];

  return {
    siteId,
    batchSize,
    dryRun,
  };
};

/**
 * Updates ATV document delete_after timestamps for all subscriptions of a given site.
 *
 * @param server - Fastify server instance
 * @param options - Migration options
 * @return Migration results with stats
 */
export const updateSubscriptionLength = async (
  server: Server,
  options: MigrationOptions,
): Promise<{ success: boolean; stats: MigrationStats; error?: unknown }> => {
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

  try {
    const collection = db.collection('subscription');
    const configLoader = SiteConfigurationLoader.getInstance();
    await configLoader.loadConfigurations();
    const siteConfig = configLoader.getConfiguration(options.siteId);

    if (!siteConfig) {
      throw new Error('Site configuration not found');
    }

    const maxAge = siteConfig.subscription.maxAge;
    // eslint-disable-next-line no-console
    console.log(`Site configuration maxAge = ${maxAge} days`);

    // Get all subscriptions
    const subscriptions = await collection.find({ site_id: options.siteId }).toArray();
    stats.total = subscriptions.length;

    // eslint-disable-next-line no-console
    console.log(`Found ${subscriptions.length} subscriptions for site: ${options.siteId}`);

    if (subscriptions.length === 0) {
      return { success: true, stats };
    }

    // Process subscriptions in batches
    const { batchSize, dryRun } = options;

    for (let i = 0; i < subscriptions.length; i += batchSize) {
      const batch = subscriptions.slice(i, i + batchSize);

      // eslint-disable-next-line no-console
      console.log(`\nbatch ${Math.floor(i / batchSize) + 1} (${batch.length} subscriptions):`);

      // eslint-disable-next-line no-await-in-loop
      await batch.reduce(async (previousPromise, subscription, index) => {
        await previousPromise;

        try {
          // Calculate delete_after: subscription.created + maxAge days
          const createdDate = new Date(subscription.created);
          const deleteAfter = calculateDeleteAfterDate(createdDate, maxAge);

          if (dryRun) {
            // eslint-disable-next-line no-console
            console.log(
              `${i + index + 1}. [DRY RUN] Would update: ${subscription._id} | Created: ${createdDate.toISOString().substring(0, 10)} | New delete_after: ${deleteAfter.toISOString().substring(0, 10)}`,
            );
            stats.updated += 1;
          } else {
            // Update ATV document with calculated delete_after
            await server.atvUpdateDocumentDeleteAfter(subscription.email, maxAge, createdDate);

            // eslint-disable-next-line no-console
            console.log(
              `${i + index + 1}. Updated: ${subscription._id} | Created: ${createdDate.toISOString().substring(0, 10)} | New delete_after: ${deleteAfter.toISOString().substring(0, 10)}`,
            );
            stats.updated += 1;
          }
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(
            `${i + index + 1}. Failed: ${subscription._id} | Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
          stats.failed += 1;
        }
      }, Promise.resolve());
    }

    // eslint-disable-next-line no-console
    console.log(`Total: ${stats.total}`);
    // eslint-disable-next-line no-console
    console.log(`Updated: ${stats.updated}`);
    // eslint-disable-next-line no-console
    console.log(`Failed: ${stats.failed}`);
    // eslint-disable-next-line no-console
    console.log(`Skipped: ${stats.skipped}`);

    return { success: true, stats };
  } catch (error) {
    console.error('Error during migration:', error);
    return { success: false, stats, error };
  }
};

command(
  async (server) => {
    const args = process.argv.slice(2);
    const parsed = parseArguments(args);

    // Get site_id from --site parameter
    if (!parsed.siteId) {
      console.error('Error: --site parameter is required');
      process.exit(1);
    }

    const { siteId, batchSize, dryRun } = parsed as MigrationOptions;

    // eslint-disable-next-line no-console
    console.log(`Target site_id: ${siteId}`);
    // eslint-disable-next-line no-console
    console.log(`Batch size: ${batchSize}`);
    // eslint-disable-next-line no-console
    console.log(`Dry run: ${dryRun}`);
    // eslint-disable-next-line no-console
    console.log('');

    const result = await updateSubscriptionLength(server, {
      siteId,
      batchSize,
      dryRun,
    });

    if (!result.success) {
      console.error('Migration failed:', result.error);
      process.exit(1);
    }
  },
  [mongodb, atv],
);
