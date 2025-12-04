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

      await batch.reduce(async (previousPromise, subscription, index) => {
        await previousPromise;

        try {
          // Calculate delete_after: subscription.created + maxAge days
          const createdDate = new Date(subscription.created);
          const deleteAfter = calculateDeleteAfterDate(createdDate, maxAge);

          if (dryRun) {
            console.log(
              `${i + index + 1}. [DRY RUN] Would update: ${subscription._id} | Created: ${createdDate.toISOString().substring(0, 10)} | New delete_after: ${deleteAfter.toISOString().substring(0, 10)}`,
            );
            stats.updated += 1;
          } else {
            // Update ATV document with calculated delete_after
            await server.atvUpdateDocumentDeleteAfter(subscription.email, maxAge, createdDate);

            console.log(
              `${i + index + 1}. Updated: ${subscription._id} | Created: ${createdDate.toISOString().substring(0, 10)} | New delete_after: ${deleteAfter.toISOString().substring(0, 10)}`,
            );
            stats.updated += 1;
          }
        } catch (error) {
          console.error(
            `${i + index + 1}. Failed: ${subscription._id} | Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
          stats.failed += 1;
        }
      }, Promise.resolve());
    }

    console.log(`Total: ${stats.total}`);
    console.log(`Updated: ${stats.updated}`);
    console.log(`Failed: ${stats.failed}`);
    console.log(`Skipped: ${stats.skipped}`);

    return { success: true, stats };
  } catch (error) {
    console.error('Error during migration:', error);
    return { success: false, stats, error };
  }
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

    const result = await updateSubscriptionLength(server, {
      siteId,
      batchSize,
      dryRun,
    });

    if (!result.success) {
      throw result.error || new Error('Migration failed');
    }
  },
  [mongodb, atv],
);
