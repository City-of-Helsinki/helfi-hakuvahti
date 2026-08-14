/**
 * MongoDB Database Initialization Script
 *
 * Creates required collections with validation schemas for the Hakuvahti application:
 * - queue: Queue for outbound notifications
 * - subscription: Search subscriptions with user preferences
 * - statistics: Aggregate per-site, per-day subscription counters
 *
 * Also creates the indexes those collections are queried through.
 *
 * Must be run before starting the application to ensure proper database structure.
 */

import command from '../lib/command.ts';
import mongodb from '../plugins/mongodb.ts';
import { QUEUE_ITEM_TYPES } from '../types/queue.ts';
import { SUBSCRIPTION_LANGUAGES } from '../types/subscription.ts';

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
            enum: [...QUEUE_ITEM_TYPES],
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

    // Statistics collection: aggregate per-site, per-day counters. Sparse — an
    // absent counter means zero — so almost nothing is required.
    const counterMap = { bsonType: 'object', additionalProperties: { bsonType: 'number' } };
    const statisticsValidator = {
      $jsonSchema: {
        bsonType: 'object',
        title: 'Hakuvahti statistics',
        required: ['_id', 'site_id', 'day', 'created'],
        properties: {
          // A string, not an objectId: `${site_id}:${day}` is deterministic, so
          // every write is an upsert on a key the caller already knows.
          _id: {
            bsonType: 'string',
            pattern: '^[a-z0-9_-]+:[0-9]{4}-[0-9]{2}-[0-9]{2}$',
          },
          site_id: {
            bsonType: 'string',
          },
          day: {
            bsonType: 'string',
            pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
          },
          created: {
            bsonType: 'date',
          },
          backfilled: {
            bsonType: 'bool',
          },
          // Open map, so adding a counter needs no collMod. Counter names are
          // governed by STAT_EVENTS in TypeScript instead.
          events: counterMap,
          // Closed map, because the one structural bug that can actually happen
          // is a `lang.undefined` subtree silently breaking the language
          // partition. Adding a language means re-running this command.
          lang: {
            bsonType: 'object',
            additionalProperties: false,
            properties: Object.fromEntries(SUBSCRIPTION_LANGUAGES.map((lang) => [lang, counterMap])),
          },
          snapshot: {
            bsonType: 'object',
            required: ['at', 'active', 'unconfirmed'],
            properties: {
              at: { bsonType: 'date' },
              active: { bsonType: 'number' },
              unconfirmed: { bsonType: 'number' },
            },
          },
        },
      },
    };

    // Serves the cron's main query, the expiry sweep, and the daily snapshot
    // counts, all of which filter on exactly these two fields. Non-fatal,
    // because it is a performance nicety and no query depends on it: the
    // `statistics` collection deliberately has no index at all, since every read
    // range-scans the always-indexed `_id` — see src/routes/stats.ts.
    try {
      await db.collection('subscription').createIndex({ site_id: 1, status: 1 });
      console.info('Subscription index ensured');
    } catch (error) {
      console.warn('Could not create the subscription index:', error);
    }

    if (!existingCollections.includes('statistics')) {
      await db.createCollection('statistics');
      console.info('Statistics collection created');
    }

    try {
      await db.command({ collMod: 'statistics', validator: statisticsValidator });
      console.info('Statistics collection validator applied');
    } catch (error) {
      // Cosmos DB does not support $jsonSchema. The validator is a dev and CI
      // safety net only; every guarantee it makes is also enforced in code, in
      // Statistics.record().
      console.warn('Could not apply statistics validator (expected on Cosmos DB):', error);
    }
  },
  [mongodb],
);
