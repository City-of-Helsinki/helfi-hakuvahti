/**
 * MongoDB Database Initialization Script
 *
 * Creates required collections with validation schemas for the Hakuvahti application:
 * - queue: Email queue for outbound notifications
 * - subscription: Search subscriptions with user preferences
 *
 * Must be run before starting the application to ensure proper database structure.
 */

import fastify from 'fastify'
import mongodb from '../plugins/mongodb';
import dotenv from 'dotenv'

dotenv.config()

const server = fastify({})

void server.register(mongodb)

const initMongoDB = async (): Promise<{ success: boolean; error?: unknown }> => {
  try {
    // Email queue collection: stores pending notification emails
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

    // Subscription collection: stores user search criteria and metadata
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
              minimum: 0,  // 0: unconfirmed, 1: active, 2: expired
              maximum: 2,
            },
            last_checked: {
              bsonType: "int"
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

    console.log('Queue collection created:', createQueue?.collectionName)
    console.log('Subscription collection created:', createSubscription?.collectionName)

    return { success: true }
  } catch (error) {
    console.error('Error initializing MongoDB:', error)
    return { success: false, error }
  }
}

// Wait for Fastify and MongoDB plugin to be fully initialized before creating collections
server.ready(async (err) => {
  if (err) {
    console.error('Server failed to start:', err)
    process.exit(1)
  }
  
  console.log('Fastify server ready')
  
  const result = await initMongoDB()
  console.log('MongoDB initialization result:', result)
  
  await server.close()
  process.exit(result.success ? 0 : 1)  // Exit with error code if initialization failed
})
