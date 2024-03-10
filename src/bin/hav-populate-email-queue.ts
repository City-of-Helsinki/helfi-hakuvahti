import fastify from 'fastify'
import mongodb from '../plugins/mongodb';
import elasticproxy from '../plugins/elasticproxy'
import dotenv from 'dotenv'
import { SubscriptionStatus } from '../types/subscription'
import decode from '../plugins/base64'
import encode from '../plugins/base64'
import { ElasticProxyJsonResponseType, PartialDrupalNodeType } from '../types/elasticproxy';
import { newHitsEmail } from '../lib/email';

dotenv.config()

const server = fastify({})

void server.register(mongodb)
void server.register(elasticproxy)
void server.register(encode)
void server.register(decode)

// Command line/cron application
// to query for new results for subscriptiots from
// ElasticProxy and add them to email queue

const massDeleteSubscriptions = async (modifyStatus: SubscriptionStatus, olderThanDays: number): Promise<void> => {
  const collection = server.mongo.db?.collection('subscription')
  if (collection) {
    const dateLimit: Date = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)
    try {
      await collection.deleteMany({ status: modifyStatus, created: { $lt: dateLimit } })
    } catch (error) {
      console.log(error)

      throw new Error('Could not delete subscriptions. See logs for errors.')
    }
  }
}

const app = async (): Promise<{}> => {
  try {
    const collection = server.mongo.db!.collection('subscription');
    const queueCollection = server.mongo.db!.collection('queue')
    const result = await collection.find({ status: 1 }).toArray();

    for (const subscription of result) {
      const elasticQuery: string = server.b64decode(subscription.elastic_query);
      const elasticResponse: ElasticProxyJsonResponseType = await server.queryElasticProxy(elasticQuery);

      if (!elasticResponse.hits.hits) {
        continue;
      }

      const createdDate: string = new Date(subscription.created).toISOString().substring(0, 10)
      const lastChecked: number = subscription.last_checked ? Math.floor(new Date(subscription.last_checked).getTime() / 1000) : Math.floor(new Date().getTime() / 1000);
      const newHits: PartialDrupalNodeType[] = elasticResponse.hits.hits
        .filter((hit: { _source: { field_publication_starts: number[]; }; }) => hit._source.field_publication_starts[0] >= lastChecked)
        .map((hit: { _source: PartialDrupalNodeType; }) => hit._source);

      if (newHits.length === 0) {
        continue
      }

      const emailContent = await newHitsEmail(subscription.lang, {
        created_date: createdDate,
        search_description: subscription.search_description,
        num_hits: newHits.length,
        hits: newHits
      })

      const email = {
        email: subscription.email,
        content: emailContent
      }

      await queueCollection.insertOne(email)

      await collection.updateOne(
        { _id: subscription._id },
        { $set: { last_checked: new Date() } }
      )
    }
  } catch (error) {
    console.error(error);
  }

  return {};
};

server.get('/', async function (request, reply) {
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
