/**
 * Schema Update Script: Add site_id as required field to subscription collection validator
 *
 * This script updates the MongoDB collection validator to make site_id a required field.
 * Run this AFTER migrating existing documents to have site_id.
 */

import command from '../lib/command';
import mongodb from '../plugins/mongodb';

command(
  async (server) => {
    // eslint-disable-next-line no-console
    console.log('Updating subscription collection schema to require site_id...');

    const db = server.mongo.db;
    if (!db) {
      throw new Error('MongoDB connection not available');
    }

    const result = await db.command({
      collMod: 'subscription',
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
    console.log('Schema updated successfully:', result);
  },
  [mongodb],
);
