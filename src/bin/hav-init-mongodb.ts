/**
 * MongoDB Database Initialization Script
 *
 * Creates required collections with validation schemas for the Hakuvahti application:
 * - queue: Queue for outbound notifications
 * - subscription: Search subscriptions with user preferences
 *
 * Must be run before starting the application to ensure proper database structure.
 */

import command from '../lib/command';
import mongodb from '../plugins/mongodb';

command(
  async (server) => {
    const db = server.mongo.db;
    if (!db) {
      throw new Error('MongoDB connection not available');
    }

    // Check if collections exist
    const collections = await db.listCollections().toArray();
    const existingCollections = collections.map((c) => c.name);

    let queueResult = null;
    let subscriptionResult = null;

    // Queue collection: stores pending notifications
    const queueValidator = {
      $jsonSchema: {
        bsonType: 'object',
        title: 'Hakuvahti notification queue',
        required: ['type', 'atv_id', 'content'],
        properties: {
          _id: {
            bsonType: 'objectId',
          },
          type: {
            bsonType: 'string',
            enum: ['email', 'sms'],
          },
          atv_id: {
            bsonType: 'string',
          },
          content: {
            bsonType: 'string',
          },
        },
      },
    };

    if (!existingCollections.includes('queue')) {
      queueResult = await db.createCollection('queue', { validator: queueValidator });
      console.info('Queue collection created:', queueResult?.collectionName);
    } else {
      await db.command({ collMod: 'queue', validator: queueValidator });
      console.info('Queue collection validator updated');
    }

    // Drop legacy smsqueue collection if it exists
    if (existingCollections.includes('smsqueue')) {
      await db.collection('smsqueue').drop();
      console.info('Dropped legacy smsqueue collection');
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
              atv_id: {
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

      console.info('Subscription collection created:', subscriptionResult?.collectionName);
    }
  },
  [mongodb],
);
