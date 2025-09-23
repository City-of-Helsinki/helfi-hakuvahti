/**
 * Migration Script: Add site_id to existing subscription documents
 * 
 * This script safely adds site_id field to existing subscription documents
 * that don't have this field. Uses configurable default site_id.
 */

import fastify from 'fastify'
import mongodb from '../plugins/mongodb'
import dotenv from 'dotenv'

dotenv.config()

const server = fastify({})
void server.register(mongodb)

interface MigrationOptions {
  defaultSiteId: string
  dryRun: boolean
  batchSize: number
}

const migrateSiteId = async (options: MigrationOptions): Promise<{ success: boolean; updated: number; error?: unknown }> => {
  try {
    const db = server.mongo.db!
    const collection = db.collection('subscription')
    
    // Find documents without site_id
    const documentsWithoutSiteId = await collection.find({
      site_id: { $exists: false }
    }).toArray()
    
    console.log(`Found ${documentsWithoutSiteId.length} documents without site_id`)
    
    if (documentsWithoutSiteId.length === 0) {
      return { success: true, updated: 0 }
    }
    
    if (options.dryRun) {
      console.log('DRY RUN - Would update the following documents:')
      documentsWithoutSiteId.forEach((doc, index) => {
        console.log(`${index + 1}. ${doc._id} - email: ${doc.email}`)
      })
      return { success: true, updated: 0 }
    }
    
    // Update documents in batches
    let totalUpdated = 0
    const batchSize = options.batchSize
    
    for (let i = 0; i < documentsWithoutSiteId.length; i += batchSize) {
      const batch = documentsWithoutSiteId.slice(i, i + batchSize)
      const ids = batch.map(doc => doc._id)
      
      const result = await collection.updateMany(
        { _id: { $in: ids } },
        { 
          $set: { 
            site_id: options.defaultSiteId,
            modified: new Date()
          }
        }
      )
      
      totalUpdated += result.modifiedCount
      console.log(`Updated batch ${Math.floor(i / batchSize) + 1}: ${result.modifiedCount} documents`)
    }
    
    console.log(`Migration completed: ${totalUpdated} documents updated with site_id: ${options.defaultSiteId}`)
    return { success: true, updated: totalUpdated }
    
  } catch (error) {
    console.error('Error during migration:', error)
    return { success: false, updated: 0, error }
  }
}

// CLI argument parsing
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const batchSize = parseInt(args.find(arg => arg.startsWith('--batch-size='))?.split('=')[1] || '100')

// Get site_id from first argument (required)
const siteId = args.find(arg => !arg.startsWith('--'))
if (!siteId) {
  console.error('Error: site_id is required')
  console.error('Usage: npm run hav:migrate-site-id <site_id> [--dry-run] [--batch-size=100]')
  console.error('Example: npm run hav:migrate-site-id rekry')
  process.exit(1)
}

server.ready(async (err) => {
  if (err) {
    console.error('Server failed to start:', err)
    process.exit(1)
  }
  
  console.log('Starting site_id migration...')
  console.log(`Target site_id: ${siteId}`)
  console.log(`Dry run: ${dryRun}`)
  console.log(`Batch size: ${batchSize}`)
  
  const result = await migrateSiteId({
    defaultSiteId: siteId,
    dryRun,
    batchSize
  })
  
  console.log('Migration result:', result)
  
  await server.close()
  process.exit(result.success ? 0 : 1)
})
