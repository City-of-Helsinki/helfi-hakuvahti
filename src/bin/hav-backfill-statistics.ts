// Reconstructs historical statistics from the subscriptions that still exist,
// for the days before live collection began. Re-runnable; never touches days
// that were measured live.
// --site to limit to one site, omit to process all
// --dry-run to preview without writing

import command from '../lib/command.ts';
import { stringArg } from '../lib/parse-args.ts';
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader.ts';
import { backfillStatistics } from '../lib/statisticsBackfill.ts';
import mongodb from '../plugins/mongodb.ts';

command(
  async (server, argv) => {
    const targetSite = stringArg(argv, 'site');
    const isDryRun = argv['dry-run'] === true;

    const db = server.mongo.db;
    if (!db) {
      throw new Error('MongoDB connection not available');
    }

    const configured = SiteConfigurationLoader.getSiteIds();

    if (targetSite && !configured.includes(targetSite)) {
      throw new Error(`Site '${targetSite}' not found. Available: ${configured.join(', ')}`);
    }

    const siteIds = targetSite ? [targetSite] : configured;

    if (isDryRun) {
      console.log('\n=== DRY RUN MODE - No changes will be made ===\n');
    }

    for (const siteId of siteIds) {
      const result = await backfillStatistics(db, { siteId, isDryRun });

      console.log(
        `${siteId}: ${result.days} day(s), ${result.confirmed} confirmation(s) before ${result.boundary}` +
          `, ${result.skipped} subscription(s) skipped for want of a first_created`,
      );
    }
  },
  [mongodb],
);
