import * as Sentry from '@sentry/node';
import command, { type Server } from '../lib/command.ts';
import { stringArg } from '../lib/parse-args.ts';
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader.ts';
import { expireSubscriptions } from '../lib/subscriptionExpiry.ts';
import { type ProcessingStats, SubscriptionProcessor } from '../lib/subscriptionProcessor.ts';
import atv from '../plugins/atv.ts';
import base64Plugin from '../plugins/base64.ts';
import elasticproxy from '../plugins/elasticproxy.ts';
import mongodb from '../plugins/mongodb.ts';
import statistics from '../plugins/statistics.ts';
import { SubscriptionStatus } from '../types/subscription.ts';

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
  const checkInId = Sentry.captureCheckIn({
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
      Sentry.captureCheckIn({ checkInId, monitorSlug: 'hav-populate-queue', status: 'error' });
      Sentry.captureException(error);
    }
    return;
  }

  if (!isDryRun) {
    Sentry.captureCheckIn({ checkInId, monitorSlug: 'hav-populate-queue', status: 'ok' });
  }
};

command(
  async function handle(server, argv) {
    const targetSite = stringArg(argv, 'site');
    const isDryRun: boolean = argv['dry-run'] === true;

    // Load site configurations
    const siteConfigs = SiteConfigurationLoader.getConfigurations();

    const db = server.mongo.db;
    if (!db) {
      throw new Error('MongoDB connection not available');
    }

    // Clean up expired subscriptions for each site. --site filters only the
    // notification pass below; expiry and measurement always cover every site, so
    // a single-site run cannot leave the others with counters but no snapshot.
    for (const [siteId, siteConfig] of Object.entries(siteConfigs)) {
      // Remove expired subscriptions that haven't been confirmed
      await expireSubscriptions(db, server.statistics, {
        siteId,
        status: SubscriptionStatus.INACTIVE,
        olderThanDays: siteConfig.subscription.unconfirmedMaxAge,
        isDryRun,
      });

      // Remove expired subscriptions
      await expireSubscriptions(db, server.statistics, {
        siteId,
        status: SubscriptionStatus.ACTIVE,
        olderThanDays: siteConfig.subscription.maxAge,
        isDryRun,
      });
    }

    // Measured after the expiry sweep, so the snapshot and the day's `expired`
    // counters describe the same moment. Deliberately before the notification
    // pass and not inside it: that work depends on Elasticsearch and ATV, and a
    // failure there must not cost every site its measurement for the day.
    if (!isDryRun) {
      for (const siteId of Object.keys(siteConfigs)) {
        await server.statistics.measure(siteId);
      }
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
    statistics,
  ],
);
