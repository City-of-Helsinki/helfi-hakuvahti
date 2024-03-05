import fastify from 'fastify'
import mongodb from '../plugins/mongodb';
import elasticproxy from '../plugins/elasticproxy'
import dotenv from 'dotenv'
import { SubscriptionStatus } from '../types/subscription'
import decode from '../plugins/base64'
import encode from '../plugins/base64'
import { ElasticProxyResponseType } from '../types/elasticproxy';
import { groupResponseAggs } from '../lib/elasticresponse';

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

const app = async (): Promise<unknown> => {
  const collection = server.mongo.db?.collection('subscription');

  // Get all enabled subscriptions
  const result = await collection?.find({ status: 1 }).toArray();

  if (result && result.length > 0) {
    for (const subscription of result) {
      const elasticQuery = server.b64decode(subscription.elastic_query)
      const elasticResponse: ElasticProxyResponseType = await server.queryElasticProxy(elasticQuery);
      const groupedResponse = groupResponseAggs(elasticResponse.responses)
      console.log(groupedResponse)

      // TODO: finish this

      break;
    }
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
