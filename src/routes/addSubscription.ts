import { 
  FastifyPluginAsync, 
  FastifyRequest, 
  FastifyReply, 
  FastifyInstance 
} from 'fastify'

import { 
  SubscriptionResponse,
  SubscriptionResponseType,
  SubscriptionCollectionType,
  SubscriptionRequest, 
  SubscriptionRequestType, 
  SubscriptionStatus
} from '../types/subscription'

import { 
  Generic500Error, 
  Generic500ErrorType
} from '../types/error'

import { confirmationEmail } from '../lib/email'
import { QueueInsertDocumentType } from '../types/mailer'

// Add subscription to given query parameters

const subscription: FastifyPluginAsync = async (
  fastify: FastifyInstance,
  opts: object
): Promise<void> => {
  fastify.post<{
    Body: SubscriptionRequestType,
    Reply: SubscriptionResponseType | Generic500ErrorType
  }>('/subscription', {
    schema: {
      body: SubscriptionRequest,
      response: {
        200: SubscriptionResponse,
        500: Generic500Error
      }
    }
  }, async (
    request: FastifyRequest<{ Body: SubscriptionRequestType }>,
    reply: FastifyReply
  ) => {
    const mongodb = fastify.mongo
    const collection = mongodb.db?.collection('subscription')
    const hash = fastify.getRandHash()

    // Replace email in request with ATV hashed email
    if (!(request?.atvResponse?.atvDocumentId))
      return reply
        .code(500)
        .header('Content-Type', 'application/json; charset=utf-8')
        .send({ error: 'Could not find hashed email. Subscription not added.' })
    request.body.email = request.atvResponse.atvDocumentId;

    // Subscription data that goes to collection
    const subscription: Partial<SubscriptionCollectionType> = {
      ...request.body,
      hash: hash,
      created: new Date(),
      modified: new Date(),
      last_checked: Math.floor(Date.now() / 1000),
      expiry_notification_sent: SubscriptionStatus.INACTIVE,
      status: SubscriptionStatus.INACTIVE
    };

    const response = await collection?.insertOne(subscription)
    if (!response) {
      fastify.log.debug(response)
      console.log(response)
      throw new Error('Adding new subscription failed. See logs.')
    }
    
    // Insert email in queue

    const subscribeLinkBase = fastify.localizedEnvVar('BASE_URL', request.body.lang)
    const emailContent = await confirmationEmail(request.body.lang, {
      link: subscribeLinkBase + `/hakuvahti/confirm?subscription=${response.insertedId}&hash=${hash}`
    })

    // Email data to queue
    const email:QueueInsertDocumentType = {
      email: request.body.email,
      content: emailContent
    }

    const q = mongodb.db?.collection('queue')
    await q?.insertOne(email)

    console.log(emailContent)

    return reply
      .code(200)
      .header('Content-Type', 'application/json; charset=utf-8')
      .send(response);
  })
}

export default subscription
