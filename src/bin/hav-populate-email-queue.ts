import fastify from 'fastify'
import mongodb from '../plugins/mongodb';
import elasticproxy from '../plugins/elasticproxy';
import dotenv from 'dotenv'

dotenv.config()

const server = fastify({})

void server.register(mongodb)
void server.register(elasticproxy)

// Command line/cron application
// to query for new results for subscriptiots from
// ElasticProxy and add them to email queue
// (collection: emailqueue)

const app = async (): Promise<unknown> => {
  const collection = server.mongo.db?.collection('subscription');

  // Get all enabled subscriptions
  const result = await collection?.find({ status: 1 }).toArray();

  if (result && result.length > 0) {
    for (const subscription of result) {
      const elasticQuery = subscription.elastic_query;
      const elasticResponse = await server.queryElasticProxy(elasticQuery);
      console.log(elasticResponse)

      // TODO: finish this
    }
  }

  return {};
};

server.get('/', async function (request, reply) {
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
