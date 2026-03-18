import command, { type Server } from '../lib/command';
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader';
import { type ProcessingStats, SubscriptionProcessor } from '../lib/subscriptionProcessor';
import atv from '../plugins/atv';
import base64Plugin from '../plugins/base64';
import elasticproxy from '../plugins/elasticproxy';
import mongodb from '../plugins/mongodb';
import '../plugins/sentry';
import { SubscriptionStatus } from '../types/subscription';

/**
 * Deletes subscriptions older than a specified number of days with a certain status for a specific site.
 *
 * @param server - fastify instance.
 * @param modifyStatus - the status to modify subscriptions
 * @param olderThanDays - the number of days to consider for deletion
 * @param siteId - the site ID to filter subscriptions
 * @return Promise that resolves when the subscriptions are deleted
 */
const massDeleteSubscriptions = async (
  server: Server,
  modifyStatus: SubscriptionStatus,
  olderThanDays: number,
  siteId: string,
): Promise<void> => {
  const collection = server.mongo.db?.collection('subscription');
  const dateLimit: Date = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  try {
    await collection?.deleteMany({
      status: modifyStatus,
      site_id: siteId,
      created: { $lt: dateLimit },
    });
  } catch (error) {
    throw new Error('Could not delete subscriptions. See logs for errors.', {
      cause: error,
    });
  }
};

/**
 * Main application function that processes all site configurations.
 *
 * @return A Promise that resolves when complete.
 */
const processSubscriptions = async (
  targetSite: string | undefined,
  isDryRun: boolean,
  server: Server,
): Promise<void> => {
  const checkInId = server.Sentry?.captureCheckIn({
    monitorSlug: 'hav-populate-queue',
    status: 'in_progress',
  });

  // Initialize statistics
  const stats: ProcessingStats = {
    sitesProcessed: 0,
    subscriptionsChecked: 0,
    expiryEmailsQueued: 0,
    newResultsEmailsQueued: 0,
    smsQueued: 0,
  };

  const processor = new SubscriptionProcessor({
    mongo: server.mongo,
    atv: server.atv,
    Sentry: server.Sentry,
    queryElasticProxy: server.queryElasticProxy,
  });

  try {
    console.log('Environment:', process.env.ENVIRONMENT || 'dev');
    if (isDryRun) {
      console.log('\n=== DRY RUN MODE - No changes will be made ===\n');
    }
    console.log('Loading site configurations...');

    // Load site configurations
    const allSiteConfigs = SiteConfigurationLoader.getConfigurations();

    // Filter by --site parameter if provided
    let siteConfigsToProcess = Object.entries(allSiteConfigs);
    if (targetSite) {
      siteConfigsToProcess = siteConfigsToProcess.filter(([siteId]) => siteId === targetSite);

      if (siteConfigsToProcess.length === 0) {
        console.error(`Error: Site '${targetSite}' not found in configurations`);
        console.log(`Available sites: ${Object.keys(allSiteConfigs).join(', ')}`);
        process.exit(1);
      }
    }

    const siteNames = siteConfigsToProcess.map(([siteId]) => siteId).join(', ');

    console.log(`Processing ${siteConfigsToProcess.length} site(s): ${siteNames}`);

    // Process each site configuration
    for (const [siteId, siteConfig] of siteConfigsToProcess) {
      console.log(`Processing subscriptions for site: ${siteId}`);
      await processor.processSiteSubscriptions(siteConfig, stats, isDryRun);
      stats.sitesProcessed++;
    }

    // Print summary
    console.log('\n=== Summary ===');
    console.log(`Sites processed: ${stats.sitesProcessed}`);
    console.log(`Subscriptions checked: ${stats.subscriptionsChecked}`);
    console.log(`Expiry emails queued: ${stats.expiryEmailsQueued}`);
    console.log(`New results emails queued: ${stats.newResultsEmailsQueued}`);
    console.log(`SMS queued: ${stats.smsQueued}`);
    if (isDryRun) {
      console.log('\n[DRY RUN] No changes were made to the database');
    }
  } catch (error) {
    console.error('Configuration loading error:', error);
    if (!isDryRun) {
      server.Sentry?.captureCheckIn({ checkInId, monitorSlug: 'hav-populate-queue', status: 'error' });
      server.Sentry?.captureException(error);
    }
    return;
  }

  if (!isDryRun) {
    server.Sentry?.captureCheckIn({ checkInId, monitorSlug: 'hav-populate-queue', status: 'ok' });
  }
};

command(
  async function handle(server, argv) {
    const targetSite: string | undefined = argv.site;
    const isDryRun: boolean = argv['dry-run'] === true;

    // Load site configurations
    const siteConfigs = SiteConfigurationLoader.getConfigurations();

    // Clean up expired subscriptions for each site
    for (const [siteId, siteConfig] of Object.entries(siteConfigs)) {
      // Remove expired subscriptions that haven't been confirmed
      await massDeleteSubscriptions(
        server,
        SubscriptionStatus.INACTIVE,
        siteConfig.subscription.unconfirmedMaxAge,
        siteId,
      );

      // Remove expired subscriptions
      await massDeleteSubscriptions(server, SubscriptionStatus.ACTIVE, siteConfig.subscription.maxAge, siteId);
    }

    // Loop through subscriptions and add new results to email queue
    await processSubscriptions(targetSite, isDryRun, server);
  },
  [
    // Register only needed plugins
    mongodb,
    elasticproxy,
    base64Plugin,
    atv,
  ],
);
