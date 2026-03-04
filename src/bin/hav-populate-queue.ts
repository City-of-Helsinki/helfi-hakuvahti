import type { ObjectId } from '@fastify/mongodb';
import command, { type Server } from '../lib/command';
import { expiryEmail, newHitsEmail, newHitsSms, renewalSms } from '../lib/email';
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader';
import { generateUniqueSmsCode } from '../lib/smsCode';
import atv from '../plugins/atv';
import base64Plugin from '../plugins/base64';
import elasticproxy from '../plugins/elasticproxy';
import mongodb from '../plugins/mongodb';
import '../plugins/sentry';
import type { ElasticProxyJsonResponseType } from '../types/elasticproxy';
import type { QueueInsertDocument } from '../types/queue';
import type { SiteConfigurationType } from '../types/siteConfig';
import { type SubscriptionCollectionType, SubscriptionStatus } from '../types/subscription';

// Statistics tracking
interface ProcessingStats {
  sitesProcessed: number;
  subscriptionsChecked: number;
  expiryEmailsQueued: number;
  newResultsEmailsQueued: number;
  smsQueued: number;
}

export const getLocalizedUrl = (siteConfig: SiteConfigurationType, langCode?: string): string => {
  const langKey = (langCode || 'fi').toLowerCase() as keyof typeof siteConfig.urls;
  if (langKey in siteConfig.urls) {
    return siteConfig.urls[langKey];
  }
  return siteConfig.urls.base;
};

// Command line/cron application
// to query for new results for subscriptions from
// ElasticProxy and add them to email queue

/**
 * Deletes subscriptions older than a specified number of days with a certain status for a specific site.
 *
 * @param server - fastify instance.
 * @param modifyStatus - the status to modify subscriptions
 * @param olderThanDays - the number of days to consider for deletion
 * @param siteId - the site ID to filter subscriptions
 * @return {Promise<void>} Promise that resolves when the subscriptions are deleted
 */
const massDeleteSubscriptions = async (
  server: Server,
  modifyStatus: SubscriptionStatus,
  olderThanDays: number,
  siteId: string,
): Promise<void> => {
  const collection = server.mongo.db?.collection('subscription');
  if (collection) {
    const dateLimit: Date = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    try {
      await collection.deleteMany({
        status: modifyStatus,
        site_id: siteId,
        created: { $lt: dateLimit },
      });
    } catch (error) {
      console.error(error);

      throw new Error('Could not delete subscriptions. See logs for errors.');
    }
  }
};

/**
 * Checks if an expiry notification should be sent for a given subscription.
 *
 * @param {Partial<SubscriptionCollectionType>} subscription - The subscription to check.
 * @param {SiteConfiguration} siteConfig - The site configuration for the subscription.
 * @return {boolean} Returns true if an expiry notification should be sent, false otherwise.
 */
const checkShouldSendExpiryNotification = (
  subscription: Partial<SubscriptionCollectionType>,
  siteConfig: SiteConfigurationType,
): boolean => {
  // Technically this is never missing but using Partial<> causes typing errors with created date otherwise...
  if (!subscription.created) {
    return false;
  }

  // Notification already sent
  if (subscription.expiry_notification_sent === 1) {
    return false;
  }

  const daysBeforeExpiry = siteConfig.subscription.expiryNotificationDays;
  const subscriptionValidForDays = siteConfig.subscription.maxAge;
  const subscriptionExpiresAt =
    new Date(subscription.created).getTime() + subscriptionValidForDays * 24 * 60 * 60 * 1000;
  const subscriptionExpiryNotificationSentAt = new Date(subscriptionExpiresAt - daysBeforeExpiry * 24 * 60 * 60 * 1000);

  return Date.now() >= subscriptionExpiryNotificationSentAt.getTime();
};

/**
 * Calculates the expected delete_after date based on subscription created date and site config maxAge.
 *
 * @param createdDate - The subscription creation date
 * @param maxAge - Number of days until deletion from site config
 * @return The calculated delete_after date
 */
export const calculateExpectedDeleteAfter = (createdDate: Date, maxAge: number): Date => {
  const deleteAfter = new Date(createdDate);
  deleteAfter.setDate(deleteAfter.getDate() + maxAge);
  return deleteAfter;
};

/**
 * Checks if the subscription's delete_after needs to be synced with ATV.
 * Compares stored delete_after with expected value based on current site config.
 *
 * @param storedDeleteAfter - The stored delete_after date from subscription (may be undefined)
 * @param expectedDeleteAfter - The expected delete_after date based on current config
 * @return True if sync is needed (missing or mismatched delete_after)
 */
export const needsDeleteAfterSync = (storedDeleteAfter: Date | undefined, expectedDeleteAfter: Date): boolean => {
  if (!storedDeleteAfter) {
    return true;
  }

  const storedDate = new Date(storedDeleteAfter);
  // Compare dates by their date string (YYYY-MM-DD)
  return storedDate.toISOString().substring(0, 10) !== expectedDeleteAfter.toISOString().substring(0, 10);
};

const getNewHitsFromElasticsearch = async (
  subscription: SubscriptionCollectionType & { _id: ObjectId },
  siteConfig: SiteConfigurationType,
  server: Server,
): Promise<Record<string, unknown>[]> => {
  let elasticQuery: string;

  if (subscription.elastic_query_atv) {
    try {
      const atvContent = await server.atvGetDocument(subscription.elastic_query as string);
      const queryObj = typeof atvContent === 'string' ? JSON.parse(atvContent) : atvContent;
      elasticQuery = server.b64decode(queryObj.elastic_query);
    } catch (e) {
      console.error(`Failed to load query from ATV for ${subscription._id}`, e);
      return [];
    }
  } else if (subscription.elastic_query) {
    elasticQuery = server.b64decode(subscription.elastic_query);
  } else {
    console.error(`Subscription ${subscription._id} has neither elastic_query nor elastic_query_atv`);
    return [];
  }

  const lastChecked: number = subscription.last_checked ? subscription.last_checked : Math.floor(Date.now() / 1000);

  try {
    // Query for new results from ElasticProxy
    const elasticResponse: ElasticProxyJsonResponseType = await server.queryElasticProxy(
      siteConfig.elasticProxyUrl,
      elasticQuery,
    );

    const matchField = siteConfig.matchField;

    // Filter out new hits:
    return (elasticResponse?.hits?.hits ?? [])
      .filter((hit: { _source?: Record<string, unknown> }) => {
        const publicationStarts = hit?._source?.[matchField];
        if (!Array.isArray(publicationStarts) || publicationStarts.length === 0) {
          return false;
        }
        return (publicationStarts[0] as number) >= lastChecked;
      })
      .map((hit: { _source: Record<string, unknown> }) => hit._source);
  } catch (err) {
    console.error(`Query ${elasticQuery} for ${subscription._id} failed`);
    server.Sentry?.captureException(err);
  }

  return [];
};

/**
 * Processes subscriptions for a specific site configuration.
 *
 * @param server - Fastify server instance.
 * @param siteConfig - The site configuration to process
 * @param stats - Statistics object to track processing
 * @param isDryRun - Do not write changes
 * @return {Promise<void>} A Promise that resolves when processing is complete
 */
const processSiteSubscriptions = async (
  server: Server,
  siteConfig: SiteConfigurationType,
  stats: ProcessingStats,
  isDryRun: boolean,
): Promise<void> => {
  const collection = server.mongo.db?.collection('subscription');
  const queueCollection = server.mongo.db?.collection('queue');

  if (!collection || !queueCollection) {
    throw new Error('MongoDB collections not available');
  }

  // List of all enabled subscriptions for this site
  const result = await collection
    .find({
      status: SubscriptionStatus.ACTIVE,
      site_id: siteConfig.id,
    })
    .toArray();

  stats.subscriptionsChecked += result.length;

  // Process subscriptions sequentially to avoid overwhelming the system
  await result.reduce(async (previousPromise, subscription) => {
    await previousPromise;

    const localizedBaseUrl = getLocalizedUrl(siteConfig, subscription.lang);

    // Calculate subscription expiry date
    const subscriptionValidForDays = siteConfig.subscription.maxAge;

    // Sync ATV delete_after if needed (handles config changes and legacy subscriptions)
    const expectedDeleteAfter = calculateExpectedDeleteAfter(new Date(subscription.created), subscriptionValidForDays);
    if (needsDeleteAfterSync(subscription.delete_after, expectedDeleteAfter)) {
      if (isDryRun) {
        console.log(
          `[DRY RUN] Would sync ATV delete_after for ${subscription._id} ` +
            `(stored: ${subscription.delete_after?.toISOString().substring(0, 10) ?? 'none'}, ` +
            `expected: ${expectedDeleteAfter.toISOString().substring(0, 10)})`,
        );
      } else {
        try {
          await server.atvUpdateDocumentDeleteAfter(
            subscription.email,
            subscriptionValidForDays,
            new Date(subscription.created),
          );
          await collection.updateOne({ _id: subscription._id }, { $set: { delete_after: expectedDeleteAfter } });
        } catch (error) {
          console.error(`Failed to sync ATV delete_after for subscription ${subscription._id}:`, error);
          server.Sentry?.captureException(error);
        }
      }
    }
    const subscriptionExpiresAt =
      new Date(subscription.created).getTime() + subscriptionValidForDays * 24 * 60 * 60 * 1000;
    const subscriptionExpiresAtDate = new Date(subscriptionExpiresAt);
    const day = String(subscriptionExpiresAtDate.getDate()).padStart(2, '0');
    const month = String(subscriptionExpiresAtDate.getMonth() + 1).padStart(2, '0'); // Months are 0-based
    const year = subscriptionExpiresAtDate.getFullYear();
    const formattedExpiryDate = `${day}.${month}.${year}`;

    // If subscription should expire soon, send an expiration email
    if (checkShouldSendExpiryNotification(subscription as Partial<SubscriptionCollectionType>, siteConfig)) {
      if (isDryRun) {
        console.log(`[DRY RUN] Would send expiry email to ${subscription.email} (site: ${siteConfig.id})`);
      } else {
        await collection.updateOne({ _id: subscription._id }, { $set: { expiry_notification_sent: 1 } });
      }

      const expiryEmailContent = await expiryEmail(
        subscription.lang,
        {
          search_description: subscription.search_description,
          link: siteConfig.urls.base + subscription.query,
          removal_date: formattedExpiryDate,
          remove_link: `${localizedBaseUrl}/hakuvahti/unsubscribe?subscription=${subscription._id}&hash=${subscription.hash}`,
          renewal_link: `${localizedBaseUrl}/hakuvahti/renew?subscription=${subscription._id}&hash=${subscription.hash}`,
          search_link: subscription.query,
        },
        siteConfig,
      );

      const expiryEmailToQueue: QueueInsertDocument = {
        type: 'email',
        atv_id: subscription.email,
        content: expiryEmailContent,
      };

      // Add email to queue
      if (!isDryRun) {
        await queueCollection.insertOne(expiryEmailToQueue);
      }
      stats.expiryEmailsQueued++;

      // Queue renewal SMS if subscription has SMS and site supports it
      if (subscription.has_sms && siteConfig.subscription.enableSms) {
        try {
          const smsCode = await generateUniqueSmsCode(collection);
          const now = new Date();

          if (!isDryRun) {
            await collection.updateOne(
              { _id: subscription._id },
              { $set: { sms_code: smsCode, sms_code_created: now } },
            );
          }

          const smsContent = await renewalSms(
            subscription.lang,
            {
              expiry_date: formattedExpiryDate,
              search_description: subscription.search_description,
              sms_code: smsCode,
            },
            siteConfig,
          );

          const smsToQueue: QueueInsertDocument = {
            type: 'sms',
            atv_id: subscription.email,
            content: smsContent,
          };

          if (isDryRun) {
            console.log(`[DRY RUN] Would queue renewal SMS for ${subscription._id} with code ${smsCode}`);
          } else {
            await queueCollection.insertOne(smsToQueue);
          }
          stats.smsQueued++;
        } catch (error) {
          console.error(`Error queueing renewal SMS for subscription ${subscription._id}:`, error);
        }
      }
    }

    const newHits = await getNewHitsFromElasticsearch(
      subscription as SubscriptionCollectionType & { _id: ObjectId },
      siteConfig,
      server,
    );

    // No new hits
    if (newHits.length === 0) {
      return Promise.resolve();
    }

    // Limit hits in email (user can see all via search_link)
    const maxHitsInEmail = siteConfig.mail.maxHitsInEmail ?? 10;
    const hitsForEmail = newHits.slice(0, maxHitsInEmail);

    // Format Mongo DateTime to EU format for email.
    const createdDate: string = new Date(subscription.created).toISOString().substring(0, 10);
    const date = new Date(createdDate);
    const pad = (n: number) => n.toString().padStart(2, '0');
    const formattedCreatedDate = `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;

    const emailContent = await newHitsEmail(
      subscription.lang,
      {
        created_date: formattedCreatedDate,
        expiry_date: formattedExpiryDate,
        search_description: subscription.search_description,
        search_link: subscription.query,
        remove_link: `${localizedBaseUrl}/hakuvahti/unsubscribe?subscription=${subscription._id}&hash=${subscription.hash}`,
        hits: hitsForEmail,
      },
      siteConfig,
    );

    const email: QueueInsertDocument = {
      type: 'email',
      atv_id: subscription.email,
      content: emailContent,
    };

    if (isDryRun) {
      console.log(
        `[DRY RUN] Would queue email for ${subscription.email}: ${newHits.length} new result(s) (site: ${siteConfig.id})`,
      );
    } else {
      // Add email to queue
      await queueCollection.insertOne(email);

      // Set last checked timestamp to this moment
      const dateUnixtime: number = Math.floor(Date.now() / 1000);
      await collection.updateOne({ _id: subscription._id }, { $set: { last_checked: dateUnixtime } });
    }
    stats.newResultsEmailsQueued++;

    // Queue SMS if subscription has SMS flag and SMS is enabled for site
    if (subscription.has_sms && siteConfig.subscription.enableSms) {
      try {
        // Regenerate SMS code for this notification
        const smsCode = await generateUniqueSmsCode(collection);
        const now = new Date();

        // Update subscription with new SMS code
        if (!isDryRun) {
          await collection.updateOne({ _id: subscription._id }, { $set: { sms_code: smsCode, sms_code_created: now } });
        }

        const smsContent = await newHitsSms(
          subscription.lang,
          {
            hits: hitsForEmail,
            search_description: subscription.search_description,
            sms_code: smsCode,
          },
          siteConfig,
        );

        const smsToQueue: QueueInsertDocument = {
          type: 'sms',
          atv_id: subscription.email,
          content: smsContent,
        };

        if (isDryRun) {
          console.log(`[DRY RUN] Would queue SMS for ${subscription._id} with code ${smsCode}`);
        } else {
          await queueCollection.insertOne(smsToQueue);
        }
        stats.smsQueued++;
      } catch (error) {
        // Log error but don't break email sending
        console.error(`Error queueing SMS for subscription ${subscription._id}:`, error);
      }
    }

    return Promise.resolve();
  }, Promise.resolve());
};

/**
 * Main application function that processes all site configurations.
 *
 * @return A Promise that resolves when complete.
 */
const app = async (targetSite: string | undefined, isDryRun: boolean, server: Server): Promise<void> => {
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

  try {
    console.log('Environment:', process.env.ENVIRONMENT || 'dev');
    if (isDryRun) {
      console.log('\n=== DRY RUN MODE - No changes will be made ===\n');
    }
    console.log('Loading site configurations...');

    // Load site configurations
    const configLoader = SiteConfigurationLoader.getInstance();
    await configLoader.loadConfigurations();
    const allSiteConfigs = configLoader.getConfigurations();

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
    console.log(`Processing ${siteConfigsToProcess.length} site(s): ${siteNames}\n`);

    // Process each site configuration
    await siteConfigsToProcess.reduce(async (previousPromise, [siteId, siteConfig]) => {
      await previousPromise;
      console.log(`Processing subscriptions for site: ${siteId}`);
      await processSiteSubscriptions(server, siteConfig, stats, isDryRun);
      stats.sitesProcessed++;
      return Promise.resolve();
    }, Promise.resolve());

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
    const configLoader = SiteConfigurationLoader.getInstance();
    await configLoader.loadConfigurations();
    const siteConfigs = configLoader.getConfigurations();

    // Clean up expired subscriptions for each site
    await Object.entries(siteConfigs).reduce(async (previousPromise, [siteId, siteConfig]) => {
      await previousPromise;

      // Remove expired subscriptions that haven't been confirmed
      await massDeleteSubscriptions(
        server,
        SubscriptionStatus.INACTIVE,
        siteConfig.subscription.unconfirmedMaxAge,
        siteId,
      );

      // Remove expired subscriptions
      await massDeleteSubscriptions(server, SubscriptionStatus.ACTIVE, siteConfig.subscription.maxAge, siteId);

      return Promise.resolve();
    }, Promise.resolve());

    // Loop through subscriptions and add new results to email queue
    await app(targetSite, isDryRun, server);
  },
  [
    // Register only needed plugins
    mongodb,
    elasticproxy,
    base64Plugin,
    atv,
  ],
);
