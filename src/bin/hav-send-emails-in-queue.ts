import fastify from 'fastify'
import mongodb from '../plugins/mongodb';
import atv from '../plugins/atv';
import mailer from '../plugins/mailer';
import '../plugins/sentry';
import dotenv from 'dotenv'
import { AtvDocumentType } from '../types/atv';
import { ObjectId } from '@fastify/mongodb';

dotenv.config()

const server = fastify({})
const release = process.env.SENTRY_RELEASE ?? '';

server.register(require('@immobiliarelabs/fastify-sentry'), {
  dsn: process.env.SENTRY_DSN,
  environment: process.env.ENVIRONMENT,
  release: release,
  setErrorHandler: true
})

// Register only needed plugins
void server.register(mailer)
void server.register(mongodb)
void server.register(atv)

// Command line/cron application to send all emails from queue collection
const BATCH_SIZE = 100

const app = async (): Promise<{}> => {
  if (typeof server.mongo?.db === 'undefined') {
    console.error('MongoDB connection not working')
    throw new Error('MongoDB connection not working')
  }

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
      const emailIdsMap = new Map<string, string|null>()

      for (const email of result) {
        emailIdsMap.set(email.email, null)
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
        const atvId = email.email
        const plaintextEmail = emailIdsMap.get(email.email)
        const dom = new JSDOM(email.content)
        const title = dom.window.document.querySelector('title')?.textContent || 'Untitled'

        // email.email is the ATV document id.
        console.info('Sending email to', atvId)

        // Check that plaintextEmail was found. No sure how this can happen,
        // maybe the ATV document was deleted before the email queue was empty?
        // Anyway, if email document was not found, sending email will fail.
        if (plaintextEmail) {
          try {
            await new Promise((resolve, reject) => server.mailer.sendMail({
              to: plaintextEmail,
              subject: title,
              html: email.content
            }, (errors, info) => {
              if (errors) {
                return reject(new Error(`Sending email to ${atvId} failed.`, { cause: errors }))
              }

              return resolve(info);
            }))
          }
          // Continue even if sending email failed.
          catch (error) {
            server.Sentry?.captureException(error)

            console.error(error);
          }
        }

        // Remove document from queue. The document is removed
        // event if the email sending does not succeed.
        const deleteResult = await queueCollection.deleteOne({_id: new ObjectId(email._id) })
        if (deleteResult.deletedCount === 0) {
          console.error(`Could not delete email document with id ${email._id} from queue`)

          throw Error('Deleting email from queue failed.')
        }
      }
    }
  }

  server.Sentry.captureCheckIn({monitorSlug: 'hav-send-emails-in-queue', status: 'ok'})
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
    if (response) {
      console.log(JSON.parse(response.payload))
    }

    server.close()
  })

})
