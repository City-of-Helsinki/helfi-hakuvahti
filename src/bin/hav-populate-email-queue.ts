import fastify from 'fastify'
import mongodb from '../plugins/mongodb';
import elasticproxy from '../plugins/elasticproxy'
import dotenv from 'dotenv'
import { SubscriptionCollectionType, SubscriptionStatus } from '../types/subscription'
import decode from '../plugins/base64'
import encode from '../plugins/base64'
import { 
  ElasticProxyJsonResponseType,
  PartialDrupalNodeType 
} from '../types/elasticproxy'
import { newHitsEmail } from '../lib/email'
import { QueueInsertDocumentType } from '../types/mailer';

dotenv.config()

const server = fastify({})

// Register only needed plugins
void server.register(mongodb)
void server.register(elasticproxy)
void server.register(encode)
void server.register(decode)

// Command line/cron application
// to query for new results for subscriptiots from
// ElasticProxy and add them to email queue

/**
 * Deletes subscriptions older than a specified number of days with a certain status.
 *
 * @param {SubscriptionStatus} modifyStatus - the status to modify subscriptions
 * @param {number} olderThanDays - the number of days to consider for deletion
 * @return {Promise<void>} Promise that resolves when the subscriptions are deleted
 */
const massDeleteSubscriptions = async (modifyStatus: SubscriptionStatus, olderThanDays: number): Promise<void> => {
  const collection = server.mongo.db?.collection('subscription')
  if (collection) {
    const dateLimit: Date = new Date(Date.now() - (olderThanDays * 24 * 60 * 60 * 1000))
    try {
      await collection.deleteMany({ status: modifyStatus, created: { $lt: dateLimit } })
    } catch (error) {
      console.log(error)

      throw new Error('Could not delete subscriptions. See logs for errors.')
    }
  }
}

/**
 * Checks if an expiry notification should be sent for a given subscription.
 *
 * @param {Partial<SubscriptionCollectionType>} subscription - The subscription to check.
 * @return {boolean} Returns true if an expiry notification should be sent, false otherwise.
 */
const checkShouldSendExpiryNotification = (subscription: Partial<SubscriptionCollectionType>): boolean => {
  // Technically this is never missing but using Partial<> causes typing errors with created date otherwise...
  if (!subscription.created) {
    return false
  }

  // Notification already sent
  if (subscription.expiry_notification_sent === 1) {
    return false
  }

  const daysBeforeExpiry = process.env.SUBSCRIPTION_EXPIRY_NOTIFICATION_DAYS ? parseInt(process.env.SUBSCRIPTION_EXPIRY_NOTIFICATION_DAYS) : 3
  const subscriptionValidForDays = process.env.SUBSCRIPTION_MAX_AGE ? parseInt(process.env.SUBSCRIPTION_MAX_AGE) : 0
  const subscriptionExpiresAt = new Date(subscription.created).getTime() + (subscriptionValidForDays * 24 * 60 * 60 * 1000)
  const subscriptionExpiryNotificationSentAt = new Date(subscriptionExpiresAt - (daysBeforeExpiry * 24 * 60 * 60 * 1000))

  return Date.now() >= subscriptionExpiryNotificationSentAt.getTime()
}

/**
 * Performs checking for new results for subscriptions and sends out emails based on the query results.
 *
 * @return {Promise<{}>} A Promise that resolves to an empty object.
 */
const app = async (): Promise<{}> => {
  try {
    // Subscriptions
    const collection = server.mongo.db!.collection('subscription')

    // Email queue
    const queueCollection = server.mongo.db!.collection('queue')

    // List of all enabled subscriptions
    const result = await collection.find({ status: SubscriptionStatus.ACTIVE }).toArray()

    for (const subscription of result) {

      // If subscription should expire soon, send an expiration email
      if (checkShouldSendExpiryNotification(subscription as Partial<SubscriptionCollectionType>)) {
        await collection.updateOne(
          { _id: subscription._id },
          { $set: { expiry_notification_sent: 1 } }
        )
      }

      // Query for new results from ElasticProxy
      const elasticQuery: string = server.b64decode(subscription.elastic_query)
      const elasticResponse: ElasticProxyJsonResponseType = await server.queryElasticProxy(elasticQuery)

      // Skip subscription if there's no hits for the query
      if (!elasticResponse.hits.hits) {
        continue;
      }

      // Filter out new hits:
      const createdDate: string = new Date(subscription.created).toISOString().substring(0, 10)
      const lastChecked: number = subscription.last_checked ? Math.floor(new Date(subscription.last_checked).getTime() / 1000) : Math.floor(new Date().getTime() / 1000)
      const newHits: PartialDrupalNodeType[] = elasticResponse.hits.hits
        .filter((hit: { _source: { field_publication_starts: number[]; }; }) => hit._source.field_publication_starts[0] >= lastChecked)
        .map((hit: { _source: PartialDrupalNodeType; }) => hit._source)

      // No new hits
      if (newHits.length === 0) {
        continue
      }

      // Email content object
      const emailContent = await newHitsEmail(subscription.lang, {
        created_date: createdDate,
        search_description: subscription.search_description,
        search_link: subscription.query,
        remove_link: '/' + subscription._id + '/' + subscription.hash,
        num_hits: newHits.length,
        hits: newHits
      })

      const email:QueueInsertDocumentType = {
        email: subscription.email,
        content: emailContent
      }

      // Add email to queue
      await queueCollection.insertOne(email)

      // Set last checked timestamp to this moment
      await collection.updateOne(
        { _id: subscription._id },
        { $set: { last_checked: new Date() } }
      )
    }
  } catch (error) {
    console.error(error)
  }

  return {}
};


server.get('/', async function (request, reply) {
  // Maximum subscription age from configuration
  const unconfirmedSubscriptionMaxAge: number = process.env.UNCONFIRMED_SUBSCRIPTION_MAX_AGE ? parseInt(process.env.UNCONFIRMED_SUBSCRIPTION_MAX_AGE) : 30
  const confirmedSubscriptionMaxAge: number = process.env.SUBSCRIPTION_MAX_AGE ? parseInt(process.env.SUBSCRIPTION_MAX_AGE) : 90

  // Remove expired subscriptions that haven't been confirmed
  await massDeleteSubscriptions(SubscriptionStatus.INACTIVE, unconfirmedSubscriptionMaxAge)

  // Remove expired subscriptions
  await massDeleteSubscriptions(SubscriptionStatus.ACTIVE, confirmedSubscriptionMaxAge)

  // Loop through subscriptions and add new results to email queue
  return await app()
})

server.ready((err) => {
  console.log('fastify server ready')
  server.inject({
    method: 'GET',
    url: '/'
  }, (err, response) => {
    console.log(JSON.parse(response.payload))

    server.close()
  })

})
