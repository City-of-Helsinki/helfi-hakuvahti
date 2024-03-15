import fastify from 'fastify'
import mongodb from '../plugins/mongodb';
import dotenv from 'dotenv'

dotenv.config()

const server = fastify({})

// Register only needed plugins
void server.register(mongodb)

const app = async (): Promise<{}> => {

  const createQueue = await server.mongo.db?.createCollection("queue", {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        title: "Hakuvahti email queue",
        required: ["email", "content"],
        properties: {
          _id: {
            "bsonType": "objectId"
          },
          email: {
            bsonType: "string",
          },
          content: {
            bsonType: "string",
          }
        }
      }
    }
  })

  const createSubscription = await server.mongo.db?.createCollection("subscription", {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        title: "Hakuvahti entries",
        required: ["email", "elastic_query", "query"],
        properties: {
          _id: {
            "bsonType": "objectId"
          },
          email: {
            bsonType: "string",
          },
          elastic_query: {
            bsonType: "string",
          },
          query: {
            bsonType: "string",
          },
          hash: {
            bsonType: "string",
          },
          expiry_notification_sent: {
            bsonType: "int",
            minimum: 0,
            maximum: 1,
          },
          status: {
            bsonType: "int",
            minimum: 0,
            maximum: 2,
          },
          last_checked: {
            bsonType: "date"
          },
          modified: {
            bsonType: "date"
          },
          created: {
            bsonType: "date"
          }
        }
      }
    }
  })

  server.log.info(createQueue)
  server.log.info(createSubscription)

  return {}
}

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
