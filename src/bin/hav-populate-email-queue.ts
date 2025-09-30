import fastify from 'fastify'
import mongodb from '../plugins/mongodb'
import elasticproxy from '../plugins/elasticproxy'
import dotenv from 'dotenv'
import { SubscriptionCollectionLanguageType, SubscriptionCollectionType, SubscriptionStatus } from '../types/subscription'
import { SiteConfigurationType } from '../types/siteConfig'
import decode from '../plugins/base64'
import encode from '../plugins/base64'
import '../plugins/sentry'
import { 
  ElasticProxyJsonResponseType,
  PartialDrupalNodeType 
} from '../types/elasticproxy'
import { expiryEmail, newHitsEmail } from '../lib/email'
import { QueueInsertDocumentType } from '../types/mailer'
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader'

dotenv.config()

const server = fastify({})
const release = process.env.SENTRY_RELEASE ?? '';

server.register(require('@immobiliarelabs/fastify-sentry'), {
  dsn: process.env.SENTRY_DSN,
  environment: process.env.ENVIRONMENT,
  release: release,
  setErrorHandler: true
})

// Register only needed plugins
void server.register(mongodb)
void server.register(elasticproxy)
void server.register(encode)
void server.register(decode)

export const getLocalizedUrl = (siteConfig: SiteConfigurationType, langCode: SubscriptionCollectionLanguageType): string => {
  const langKey = langCode.toLowerCase() as keyof typeof siteConfig.urls
  if (langKey in siteConfig.urls) {
    return siteConfig.urls[langKey]
  }
  return siteConfig.urls.base
}

// Command line/cron application
// to query for new results for subscriptions from
// ElasticProxy and add them to email queue

/**
 * Deletes subscriptions older than a specified number of days with a certain status for a specific site.
 *
 * @param {SubscriptionStatus} modifyStatus - the status to modify subscriptions
 * @param {number} olderThanDays - the number of days to consider for deletion
 * @param {string} siteId - the site ID to filter subscriptions
 * @return {Promise<void>} Promise that resolves when the subscriptions are deleted
 */
const massDeleteSubscriptions = async (modifyStatus: SubscriptionStatus, olderThanDays: number, siteId: string): Promise<void> => {
  const collection = server.mongo.db?.collection('subscription')
  if (collection) {
    const dateLimit: Date = new Date(Date.now() - (olderThanDays * 24 * 60 * 60 * 1000))
    try {
      await collection.deleteMany({ 
        status: modifyStatus, 
        site_id: siteId,
        created: { $lt: dateLimit } 
      })
    } catch (error) {
      console.error(error)

      throw new Error('Could not delete subscriptions. See logs for errors.')
    }
  }
}

/**
 * Checks if an expiry notification should be sent for a given subscription.
 *
 * @param {Partial<SubscriptionCollectionType>} subscription - The subscription to check.
 * @param {SiteConfiguration} siteConfig - The site configuration for the subscription.
 * @return {boolean} Returns true if an expiry notification should be sent, false otherwise.
 */
const checkShouldSendExpiryNotification = (subscription: Partial<SubscriptionCollectionType>, siteConfig: SiteConfigurationType): boolean => {
  // Technically this is never missing but using Partial<> causes typing errors with created date otherwise...
  if (!subscription.created) {
    return false
  }

  // Notification already sent
  if (subscription.expiry_notification_sent === 1) {
    return false
  }

  const daysBeforeExpiry = siteConfig.subscription.expiryNotificationDays
  const subscriptionValidForDays = siteConfig.subscription.maxAge
  const subscriptionExpiresAt = new Date(subscription.created).getTime() + (subscriptionValidForDays * 24 * 60 * 60 * 1000)
  const subscriptionExpiryNotificationSentAt = new Date(subscriptionExpiresAt - (daysBeforeExpiry * 24 * 60 * 60 * 1000))

  return Date.now() >= subscriptionExpiryNotificationSentAt.getTime()
}

const getNewHitsFromElasticsearch = async (subscription: SubscriptionCollectionType & { _id: any }, siteConfig: SiteConfigurationType): Promise<PartialDrupalNodeType[]> => {
  const elasticQuery: string = server.b64decode(subscription.elastic_query)
  const lastChecked: number = subscription.last_checked ? subscription.last_checked : Math.floor(new Date().getTime() / 1000)

  try {
    // Query for new results from ElasticProxy
    const elasticResponse: ElasticProxyJsonResponseType = await server.queryElasticProxy(siteConfig.elasticProxyUrl, elasticQuery)

    // Filter out new hits:
    return (elasticResponse?.hits?.hits ?? [])
        .filter((hit: any) => {
          const publicationStarts = hit?._source?.field_publication_starts
          if (!Array.isArray(publicationStarts) || publicationStarts.length === 0) {
            return false
          }
          return publicationStarts[0] >= lastChecked
        })
        .map((hit: { _source: PartialDrupalNodeType; }) => hit._source)

  } catch (err) {
    console.error(`Query ${elasticQuery} for ${subscription._id} failed`)
    server.Sentry?.captureException(err)
  }

  return []
}

/**
 * Processes subscriptions for a specific site configuration.
 *
 * @param {SiteConfiguration} siteConfig - The site configuration to process
 * @return {Promise<void>} A Promise that resolves when processing is complete
 */
const processSiteSubscriptions = async (siteConfig: SiteConfigurationType): Promise<void> => {
  const collection = server.mongo.db!.collection('subscription')
  const queueCollection = server.mongo.db!.collection('queue')

  // List of all enabled subscriptions for this site
  const result = await collection.find({ 
    status: SubscriptionStatus.ACTIVE,
    site_id: siteConfig.id 
  }).toArray()

  for (const subscription of result) {
    const localizedBaseUrl = getLocalizedUrl(siteConfig, subscription.lang)

    // If subscription should expire soon, send an expiration email
    if (checkShouldSendExpiryNotification(subscription as Partial<SubscriptionCollectionType>, siteConfig)) {
      await collection.updateOne(
        { _id: subscription._id },
        { $set: { expiry_notification_sent: 1 } }
      )

      const subscriptionValidForDays = siteConfig.subscription.maxAge
      const subscriptionExpiresAt = new Date(subscription.created).getTime() + (subscriptionValidForDays * 24 * 60 * 60 * 1000)
      const subscriptionExpiresAtDate = new Date(subscriptionExpiresAt)
      const day = String(subscriptionExpiresAtDate.getDate()).padStart(2, '0')
      const month = String(subscriptionExpiresAtDate.getMonth() + 1).padStart(2, '0') // Months are 0-based
      const year = subscriptionExpiresAtDate.getFullYear()
      const formattedExpiryDate = `${day}.${month}.${year}`

      const expiryEmailContent = await expiryEmail(subscription.lang, {
        search_description: subscription.search_description,
        link: siteConfig.urls.base + subscription.query,
        removal_date: formattedExpiryDate,
        remove_link: localizedBaseUrl + '/hakuvahti/unsubscribe?subscription=' + subscription._id + '&hash=' + subscription.hash,
      }, siteConfig)

      const expiryEmailToQueue: QueueInsertDocumentType = {
        email: subscription.email,
        content: expiryEmailContent
      }

      // Add email to queue
      await queueCollection.insertOne(expiryEmailToQueue)
    }

    const newHits = await getNewHitsFromElasticsearch(subscription as SubscriptionCollectionType & { _id: any }, siteConfig)

    // No new hits
    if (newHits.length === 0) {
      continue
    }

    // Format Mongo DateTime to EU format for email.
    const createdDate: string = new Date(subscription.created).toISOString().substring(0, 10)
    const date = new Date(createdDate);
    const pad = (n: number) => n.toString().padStart(2, '0');
    const formattedCreatedDate = `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;

    const emailContent = await newHitsEmail(subscription.lang, {
      created_date: formattedCreatedDate,
      search_description: subscription.search_description,
      search_link: subscription.query,
      remove_link: localizedBaseUrl + '/hakuvahti/unsubscribe?subscription=' + subscription._id + '&hash=' + subscription.hash,
      hits: newHits
    }, siteConfig)

    const email: QueueInsertDocumentType = {
      email: subscription.email,
      content: emailContent
    }

    // Add email to queue
    await queueCollection.insertOne(email)

    // Set last checked timestamp to this moment
    const dateUnixtime: number = Math.floor(new Date().getTime() / 1000)

    await collection.updateOne(
      { _id: subscription._id },
      { $set: { last_checked: dateUnixtime } }
    )
  }
}

/**
 * Main application function that processes all site configurations.
 *
 * @return {Promise<{}>} A Promise that resolves to an empty object.
 */
const app = async (): Promise<{}> => {
  const checkInId = server.Sentry?.captureCheckIn({
    monitorSlug: 'hav-populate-email-queue',
    status: 'in_progress'
  });

  try {
    console.log('Environment:', process.env.ENVIRONMENT || 'dev')
    console.log('Loading site configurations...')
    
    // Load site configurations
    const configLoader = SiteConfigurationLoader.getInstance()
    await configLoader.loadConfigurations()
    const siteConfigs = configLoader.getConfigurations()
    
    console.log('Loaded configurations for sites:', Object.keys(siteConfigs))

    // Process each site configuration
    for (const [siteId, siteConfig] of Object.entries(siteConfigs)) {
      console.log(`Processing subscriptions for site: ${siteId}`)
      await processSiteSubscriptions(siteConfig)
    }

  } catch (error) {
    console.error('Configuration loading error:', error)
    server.Sentry?.captureCheckIn({checkInId, monitorSlug: 'hav-populate-email-queue', status: 'error'})
    server.Sentry?.captureException(error)
    return {};
  }

  server.Sentry?.captureCheckIn({checkInId, monitorSlug: 'hav-populate-email-queue', status: 'ok'})
  return {}
};

server.get('/', async function (request, reply) {
  // Load site configurations
  const configLoader = SiteConfigurationLoader.getInstance()
  await configLoader.loadConfigurations()
  const siteConfigs = configLoader.getConfigurations()

  // Clean up expired subscriptions for each site
  for (const [siteId, siteConfig] of Object.entries(siteConfigs)) {
    // Remove expired subscriptions that haven't been confirmed
    await massDeleteSubscriptions(SubscriptionStatus.INACTIVE, siteConfig.subscription.unconfirmedMaxAge, siteId)

    // Remove expired subscriptions
    await massDeleteSubscriptions(SubscriptionStatus.ACTIVE, siteConfig.subscription.maxAge, siteId)
  }

  // Loop through subscriptions and add new results to email queue
  return await app()
})

server.ready((err) => {
  console.log('fastify server ready')
  server.inject({
    method: 'GET',
    url: '/'
  }, (err, response) => {
    if (response) {
      console.log(JSON.parse(response.payload))
    }

    server.close()
  })

})
