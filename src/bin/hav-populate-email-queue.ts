import fastify from 'fastify'
import mongodb from '../plugins/mongodb';
import elasticproxy from '../plugins/elasticproxy'
import dotenv from 'dotenv'
import { SubscriptionStatus } from '../types/subscription'
import decode from '../plugins/base64'
import encode from '../plugins/base64'
import { ElasticProxyResponseItemType, PartialDrupalNodeType } from '../types/elasticproxy';

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
    const baseUrl: string = process.env.BASE_URL || 'http://localhost:3000';
    const collection = server.mongo.db!.collection('subscription');
    const result = await collection.find({ status: 1 }).toArray();

    if (result.length > 0) {
      for (const subscription of result) {
        const elasticQuery: string = server.b64decode(subscription.elastic_query);
        const elasticResponse: ElasticProxyResponseItemType = await server.queryElasticProxy(elasticQuery);

        // Last checked timestamp as Unixtime
        const lastChecked: number = subscription.last_checked ? Math.floor(new Date(subscription.last_checked).getTime() / 1000) : Math.floor(new Date().getTime() / 1000);

        if (!elasticResponse.hits.hits) {
          continue;
        }

        // Get new hits for this subscription query since last_checked timestamp
        const newHits: PartialDrupalNodeType[] = elasticResponse.hits.hits
          .filter((hit: { _source: { field_publication_starts: number[]; }; }) => hit._source.field_publication_starts[0] >= lastChecked)
          .map((hit: { _source: PartialDrupalNodeType; }) => hit._source);

        // Update last checked timestamp to current date
        await collection.updateOne(
          { _id: subscription._id },
          { $set: { last_checked: new Date() } }
        );

        console.log(newHits);
      }
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
