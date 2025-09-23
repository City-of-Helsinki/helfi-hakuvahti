/**
 * Schema Update Script: Add site_id as required field to subscription collection validator
 * 
 * This script updates the MongoDB collection validator to make site_id a required field.
 * Run this AFTER migrating existing documents to have site_id.
 */

import fastify from 'fastify'
import mongodb from '../plugins/mongodb'
import dotenv from 'dotenv'

dotenv.config()

const server = fastify({})
void server.register(mongodb)

const updateSchema = async (): Promise<{ success: boolean; error?: unknown }> => {
  try {
    const db = server.mongo.db!
    
    const result = await db.command({
      collMod: 'subscription',
      validator: {
        $jsonSchema: {
          bsonType: "object",
          title: "Hakuvahti entries",
          required: ["email", "elastic_query", "query", "site_id"],
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
            site_id: {
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
    
    console.log('Schema updated successfully:', result)
    return { success: true }
    
  } catch (error) {
    console.error('Error updating schema:', error)
    return { success: false, error }
  }
}

server.ready(async (err) => {
  if (err) {
    console.error('Server failed to start:', err)
    process.exit(1)
  }
  
  console.log('Updating subscription collection schema to require site_id...')

  const result = await updateSchema()
  console.log('Schema update result:', result)
  
  await server.close()
  process.exit(result.success ? 0 : 1)
})
