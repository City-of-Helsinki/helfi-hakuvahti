import fastify from 'fastify'
import mongodb from '../plugins/mongodb';
import atv from '../plugins/atv';
import mailer from '../plugins/mailer';
import dotenv from 'dotenv'
import { AtvDocumentType } from '../types/atv';
import { ObjectId } from '@fastify/mongodb';

dotenv.config()

const server = fastify({})

// Register only needed plugins
void server.register(mailer)
void server.register(mongodb)
void server.register(atv)

// Command line/cron application to send all emails from queue collection

const BATCH_SIZE = 100

const app = async (): Promise<{}> => {
  try {
    // Email queue
    const queueCollection = server.mongo.db!.collection('queue')
    const jsdom = require('jsdom')
    const { JSDOM } = jsdom

    let hasMoreResults = true

    while (hasMoreResults) {
      const result = await queueCollection.find({}).limit(BATCH_SIZE).toArray()

      if (result.length === 0) {
        hasMoreResults = false
      } else {
        // Collect email ids as map
        const emailIdsMap = new Map<string, string>()

        for (const email of result) {
          emailIdsMap.set(email.email, email.email)
        }

        // Get batch of email documents from ATV
        const emailIds = [...emailIdsMap.keys()]
        const emailDocuments:Partial<AtvDocumentType[]> = await server.atvGetDocumentBatch(emailIds)

        // Update the email map with unencrypted email list
        if (emailDocuments.length > 0) {
          for (const emailDocument of emailDocuments) {
            if (emailDocument?.id) {
              emailIdsMap.set(emailDocument.id, emailDocument.content.email)
            }
          }
        }

        // Send emails
        for (const email of result) {
          const plaintextEmail = emailIdsMap.get(email.email)
          const dom = new JSDOM(email.content)
          const title = dom.window.document.querySelector('title')?.textContent || 'Untitled'
          
          // Send email
          const res = server.mailer.sendMail({
            to: plaintextEmail,
            subject: title,
            html: email.content
          }, (errors, info) => {
            if (errors) {
              server.log.error(errors)
        
              throw Error('Sending email failed. See logs')
            }
          })

          // Remove document from queue
          const deleteResult = await queueCollection.deleteOne({_id: new ObjectId(email._id) })
          if (deleteResult.deletedCount === 0) {
            console.error(`Could not delete email document with id ${email._id} from queue`)

            throw Error('Deleting email from queue failed. See logs')
          }

          console.log(res)
        }
      }
    }

  } catch (error) {
    console.error(error)
  }

  return {}
}

server.get('/', async function (request, reply) {
  // Send all emails from queue
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
