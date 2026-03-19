import { Buffer } from 'node:buffer';
import type { FastifyMongoNestedObject, FastifyMongoObject, ObjectId } from '@fastify/mongodb';
import type * as Sentry from '@sentry/node';
import type { WithId } from 'mongodb';
import type { ElasticProxyJsonResponseType } from '../types/elasticproxy';
import type { QueueInsertDocument } from '../types/queue';
import type { SiteConfigurationType } from '../types/siteConfig';
import { type SubscriptionCollectionType, SubscriptionStatus } from '../types/subscription';
import { ATV } from './atv';
import { expiryEmail, newHitsEmail, newHitsSms, renewalSms } from './email';
import { SiteConfigurationLoader } from './siteConfigurationLoader';

export interface SubscriptionProcessorDeps {
  mongo: FastifyMongoObject & FastifyMongoNestedObject;
  atv: ATV;
  Sentry?: typeof Sentry;
  queryElasticProxy(elasticProxyBaseUrl: string, elasticQueryJson: string): Promise<ElasticProxyJsonResponseType>;
}

// Statistics tracking
export interface ProcessingStats {
  sitesProcessed: number;
  subscriptionsChecked: number;
  expiryEmailsQueued: number;
  newResultsEmailsQueued: number;
  smsQueued: number;
}

const isEmailActive = (sub: Partial<SubscriptionCollectionType>): boolean =>
  sub.email_confirmed !== undefined ? sub.email_confirmed === true : sub.status === SubscriptionStatus.ACTIVE; // legacy fallback

const isSmsActive = (sub: Partial<SubscriptionCollectionType>): boolean => sub.sms_confirmed === true;

const checkShouldSendExpiryNotification = (
  subscription: Partial<SubscriptionCollectionType>,
  siteConfig: SiteConfigurationType,
): boolean => {
  if (!subscription.created) {
    return false;
  }

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
 */
export const calculateExpectedDeleteAfter = (createdDate: Date, maxAge: number): Date => {
  const deleteAfter = new Date(createdDate);
  deleteAfter.setDate(deleteAfter.getDate() + maxAge);
  return deleteAfter;
};

/**
 * Checks if the subscription's delete_after needs to be synced with ATV.
 */
export const needsDeleteAfterSync = (storedDeleteAfter: Date | undefined, expectedDeleteAfter: Date): boolean => {
  if (!storedDeleteAfter) {
    return true;
  }

  const storedDate = new Date(storedDeleteAfter);
  return storedDate.toISOString().substring(0, 10) !== expectedDeleteAfter.toISOString().substring(0, 10);
};

export class SubscriptionProcessor {
  private readonly mongo: SubscriptionProcessorDeps['mongo'];
  private readonly atv: SubscriptionProcessorDeps['atv'];
  private readonly sentry: SubscriptionProcessorDeps['Sentry'];
  private readonly queryElasticProxy: SubscriptionProcessorDeps['queryElasticProxy'];

  constructor({ mongo, atv, Sentry, queryElasticProxy }: SubscriptionProcessorDeps) {
    this.mongo = mongo;
    this.atv = atv;
    this.sentry = Sentry;
    this.queryElasticProxy = queryElasticProxy;
  }

  /**
   * Processes subscriptions for a specific site configuration.
   */
  async processSiteSubscriptions(
    siteConfig: SiteConfigurationType,
    stats: ProcessingStats,
    isDryRun: boolean,
  ): Promise<void> {
    const collection = this.mongo.db?.collection('subscription');
    const queueCollection = this.mongo.db?.collection('queue');

    if (!collection || !queueCollection) {
      throw new Error('MongoDB collections not available');
    }

    // List of all enabled subscriptions for this site
    // @fixme This query needs to have a limit so the memory
    //   usage doesn't grow without bounds.
    const result = await collection
      .find({
        status: SubscriptionStatus.ACTIVE,
        site_id: siteConfig.id,
      })
      .toArray();

    stats.subscriptionsChecked += result.length;

    // Process subscriptions sequentially to avoid overwhelming the system
    await result.reduce(async (previousPromise, subscription) => {
      // @todo move this to a for loop, using
      //   reduce() here is quite hard to reason.
      await previousPromise;

      console.info(`Processing subscription ${subscription._id} for site ${siteConfig.id}`);

      // Resolve user data from ATV if stored there
      let resolvedQuery: string = subscription.query;
      let resolvedSearchDescription: string = subscription.search_description ?? '';
      let resolvedElasticQuery: string | undefined = subscription.elastic_query;

      if (subscription.user_data_in_atv) {
        try {
          const atvData = await this.atv.getDocument(ATV.getAtvId(subscription));
          resolvedQuery = atvData.query ?? '';
          resolvedSearchDescription = atvData.search_description ?? '';
          resolvedElasticQuery = atvData.elastic_query;

          console.info(`Subscription details loaded from ATV for ${subscription._id} (site: ${siteConfig.id})`);
        } catch (e) {
          console.error(`Failed to load user data from ATV for ${subscription._id}`, e);
          this.sentry?.captureException(e);
          return Promise.resolve();
        }
      }

      const localizedBaseUrl = SiteConfigurationLoader.getLocalizedUrl(siteConfig, subscription.lang);

      // Calculate subscription expiry date
      const subscriptionValidForDays = siteConfig.subscription.maxAge;

      // Sync ATV delete_after if needed (handles config changes and legacy subscriptions)
      // @todo: why do we need this?
      const expectedDeleteAfter = calculateExpectedDeleteAfter(
        new Date(subscription.created),
        subscriptionValidForDays,
      );
      if (needsDeleteAfterSync(subscription.delete_after, expectedDeleteAfter)) {
        console.info(
          `Sync ATV delete_after for ${subscription._id} ` +
            `(stored: ${subscription.delete_after?.toISOString().substring(0, 10) ?? 'none'}, ` +
            `expected: ${expectedDeleteAfter.toISOString().substring(0, 10)})`,
        );

        if (!isDryRun) {
          try {
            await this.atv.updateDocumentDeleteAfter(
              ATV.getAtvId(subscription),
              subscriptionValidForDays,
              new Date(subscription.created),
            );
            await collection.updateOne({ _id: subscription._id }, { $set: { delete_after: expectedDeleteAfter } });
          } catch (error) {
            console.error(`Failed to sync ATV delete_after for subscription ${subscription._id}:`, error);
            this.sentry?.captureException(error);
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
        console.info(`Sending expiry email to ${ATV.getAtvId(subscription)} (site: ${siteConfig.id})`);

        // @fixme: dry run keeps spamming the messages and should
        //   newer be used in production. Why do we need dry-run feature?
        if (!isDryRun) {
          await collection.updateOne({ _id: subscription._id }, { $set: { expiry_notification_sent: 1 } });
        }

        // Queue expiry email if email is active
        if (isEmailActive(subscription as Partial<SubscriptionCollectionType>)) {
          try {
            const expiryEmailContent = await expiryEmail(
              subscription.lang,
              {
                search_description: resolvedSearchDescription,
                link: siteConfig.urls.base + resolvedQuery,
                removal_date: formattedExpiryDate,
                remove_link: `${localizedBaseUrl}/hakuvahti/unsubscribe?subscription=${subscription._id}&hash=${subscription.hash}`,
                renewal_link: `${localizedBaseUrl}/hakuvahti/renew?subscription=${subscription._id}&hash=${subscription.hash}`,
                search_link: resolvedQuery,
              },
              siteConfig,
            );

            const expiryEmailToQueue: QueueInsertDocument = {
              type: 'email',
              atv_id: ATV.getAtvId(subscription),
              content: expiryEmailContent,
            };

            if (!isDryRun) {
              await queueCollection.insertOne(expiryEmailToQueue);
            }
            stats.expiryEmailsQueued++;
          } catch (error) {
            console.error(`Error queueing expiry email for subscription ${subscription._id}:`, error);
            this.sentry?.captureException(error);
          }
        }

        // Queue renewal SMS if subscription has SMS and site supports it
        if (isSmsActive(subscription as Partial<SubscriptionCollectionType>) && siteConfig.subscription.enableSms) {
          console.info(`Sending expiry SMS for ${subscription._id} (site: ${siteConfig.id})`);

          try {
            const smsContent = await renewalSms(
              subscription.lang,
              {
                expiry_date: formattedExpiryDate,
                search_description: resolvedSearchDescription,
                id: subscription._id.toString(),
              },
              siteConfig,
            );

            const smsToQueue: QueueInsertDocument = {
              type: 'sms',
              atv_id: ATV.getAtvId(subscription),
              content: smsContent,
            };

            if (!isDryRun) {
            } else {
              await queueCollection.insertOne(smsToQueue);
            }
            stats.smsQueued++;
          } catch (error) {
            console.error(`Error queueing renewal SMS for subscription ${subscription._id}:`, error);
            this.sentry?.captureException(error);
          }
        }
      }

      const newHits = await this.getNewHitsFromElasticsearch(
        subscription as SubscriptionCollectionType & { _id: ObjectId },
        siteConfig,
        resolvedElasticQuery,
      );

      // No new hits
      if (newHits.length === 0) {
        console.info(`No hits for ${subscription._id} from ${siteConfig.name}`);
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

      // Update last_checked regardless of channel
      if (!isDryRun) {
        const dateUnixtime: number = Math.floor(Date.now() / 1000);
        await collection.updateOne({ _id: subscription._id }, { $set: { last_checked: dateUnixtime } });
      }

      // Queue new hits email if email is active
      if (isEmailActive(subscription as Partial<SubscriptionCollectionType>)) {
        try {
          const emailContent = await newHitsEmail(
            subscription.lang,
            {
              created_date: formattedCreatedDate,
              expiry_date: formattedExpiryDate,
              search_description: resolvedSearchDescription,
              search_link: resolvedQuery,
              remove_link: `${localizedBaseUrl}/hakuvahti/unsubscribe?subscription=${subscription._id}&hash=${subscription.hash}`,
              hits: hitsForEmail,
            },
            siteConfig,
          );

          const email: QueueInsertDocument = {
            type: 'email',
            atv_id: ATV.getAtvId(subscription),
            content: emailContent,
          };

          console.info(
            `New email for ${ATV.getAtvId(subscription)}: ${newHits.length} new result(s) (site: ${siteConfig.id})`,
          );

          if (!isDryRun) {
            await queueCollection.insertOne(email);
          }
          stats.newResultsEmailsQueued++;
        } catch (error) {
          // Log error but don't break email sending
          console.error(`Error queueing SMS for subscription ${subscription._id}:`, error);
        }
      }

      // Queue SMS if subscription has SMS confirmed and SMS is enabled for site
      if (isSmsActive(subscription as Partial<SubscriptionCollectionType>) && siteConfig.subscription.enableSms) {
        try {
          const smsContent = await newHitsSms(
            subscription.lang,
            {
              search_description: resolvedSearchDescription,
              id: subscription._id.toString(),
              hits: hitsForEmail,
            },
            siteConfig,
          );

          const smsToQueue: QueueInsertDocument = {
            type: 'sms',
            atv_id: ATV.getAtvId(subscription),
            content: smsContent,
          };

          console.log(`New SMS for ${subscription._id}: ${newHits.length} new result(s) (site: ${siteConfig.id})`);

          if (!isDryRun) {
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
  }

  private async getNewHitsFromElasticsearch(
    subscription: WithId<SubscriptionCollectionType>,
    siteConfig: SiteConfigurationType,
    resolvedElasticQuery?: string,
  ): Promise<Record<string, unknown>[]> {
    if (!resolvedElasticQuery) {
      console.error(`Subscription ${subscription._id} has no elastic_query`);
      return [];
    }

    const elasticQuery = Buffer.from(resolvedElasticQuery, 'base64').toString('utf-8');

    const lastChecked: number = subscription.last_checked ? subscription.last_checked : Math.floor(Date.now() / 1000);

    try {
      const elasticResponse: ElasticProxyJsonResponseType = await this.queryElasticProxy(
        siteConfig.elasticProxyUrl,
        elasticQuery,
      );

      const matchField = siteConfig.matchField;

      console.info(
        `Matched ${elasticResponse?.hits?.total?.value ?? 0} hits for ${subscription._id} from ${siteConfig.name}`,
      );

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
      this.sentry?.captureException(err);
    }

    return [];
  }
}
