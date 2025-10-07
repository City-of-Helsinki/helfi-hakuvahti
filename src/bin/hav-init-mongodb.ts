/**
 * MongoDB Database Initialization Script
 *
 * Creates required collections with validation schemas for the Hakuvahti application:
 * - queue: Email queue for outbound notifications
 * - subscription: Search subscriptions with user preferences
 *
 * Must be run before starting the application to ensure proper database structure.
 */

import dotenv from 'dotenv';
import fastify from 'fastify';
import mongodb from '../plugins/mongodb';

dotenv.config();

const server = fastify({});

// eslint-disable-next-line no-void
void server.register(mongodb);

const initMongoDB = async (): Promise<{ success: boolean; error?: unknown }> => {
  try {
    const db = server.mongo.db;
    if (!db) {
      throw new Error('MongoDB connection not available');
    }

    // Check if collections exist
    const collections = await db.listCollections().toArray();
    const existingCollections = collections.map((c) => c.name);

    let queueResult = null;
    let smsQueueResult = null;
    let subscriptionResult = null;

    // Email queue collection: stores pending notification emails
    if (!existingCollections.includes('queue')) {
      queueResult = await db.createCollection('queue', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            title: 'Hakuvahti email queue',
            required: ['email', 'content'],
            properties: {
              _id: {
                bsonType: 'objectId',
              },
              email: {
                bsonType: 'string',
              },
              content: {
                bsonType: 'string',
              },
            },
          },
        },
      });
      // eslint-disable-next-line no-console
      console.log('Queue collection created:', queueResult?.collectionName);
    } else {
      // eslint-disable-next-line no-console
      console.log('Queue collection already exists');
    }

    // SMS queue collection: stores pending notification SMS messages
    if (!existingCollections.includes('smsqueue')) {
      smsQueueResult = await db.createCollection('smsqueue', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            title: 'Hakuvahti SMS queue',
            required: ['sms', 'content'],
            properties: {
              _id: {
                bsonType: 'objectId',
              },
              sms: {
                bsonType: 'string',
              },
              content: {
                bsonType: 'string',
              },
            },
          },
        },
      });
      // eslint-disable-next-line no-console
      console.log('SMS queue collection created:', smsQueueResult?.collectionName);
    } else {
      // eslint-disable-next-line no-console
      console.log('SMS queue collection already exists');
    }

    // Subscription collection: stores user search criteria and metadata
    if (!existingCollections.includes('subscription')) {
      subscriptionResult = await db.createCollection('subscription', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            title: 'Hakuvahti entries',
            required: ['email', 'elastic_query', 'query', 'site_id'],
            properties: {
              _id: {
                bsonType: 'objectId',
              },
              email: {
                bsonType: 'string',
              },
              elastic_query: {
                bsonType: 'string',
              },
              query: {
                bsonType: 'string',
              },
              site_id: {
                bsonType: 'string',
              },
              hash: {
                bsonType: 'string',
              },
              expiry_notification_sent: {
                bsonType: 'int',
                minimum: 0,
                maximum: 1,
              },
              status: {
                bsonType: 'int',
                minimum: 0, // 0: unconfirmed, 1: active, 2: expired
                maximum: 2,
              },
              last_checked: {
                bsonType: 'int',
              },
              modified: {
                bsonType: 'date',
              },
              created: {
                bsonType: 'date',
              },
            },
          },
        },
      });
      // eslint-disable-next-line no-console
      console.log('Subscription collection created:', subscriptionResult?.collectionName);
    }

    return { success: true };
  } catch (error) {
    console.error('Error initializing MongoDB:', error);
    return { success: false, error };
  }
};

// Wait for Fastify and MongoDB plugin to be fully initialized before creating collections
server.ready(async (err) => {
  if (err) {
    console.error('Server failed to start:', err);
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log('Fastify server ready');

  const result = await initMongoDB();
  // eslint-disable-next-line no-console
  console.log('MongoDB initialization result:', result);

  await server.close();
  process.exit(result.success ? 0 : 1); // Exit with error code if initialization failed
});
