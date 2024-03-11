import { 
  FastifyPluginAsync, 
  FastifyReply, 
  FastifyInstance, 
  FastifyRequest
} from 'fastify'

import { 
  Generic500Error, 
  Generic500ErrorType 
} from '../types/error'

import { 
  SubscriptionGenericPostResponse, 
  SubscriptionGenericPostResponseType, 
  SubscriptionStatus
} from '../types/subscription'

import { ObjectId } from '@fastify/mongodb'
  
// Confirms subscription
  
const confirmSubscription: FastifyPluginAsync = async (
  fastify: FastifyInstance,
  opts: object
): Promise<void> => {
  fastify.get<{
    Reply: SubscriptionGenericPostResponseType | Generic500ErrorType
  }>('/subscription/confirm/:id/:hash', {
    schema: {
      response: {
        200: SubscriptionGenericPostResponse,
        500: Generic500Error
      }
    }
  }, async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const mongodb = fastify.mongo
    const collection = mongodb.db?.collection('subscription');
    const { id, hash } = <{ id: string, hash: string }>request.params

    try {
      const subscription = await collection?.findOne({ 
        _id: new ObjectId(id), 
        hash: hash, 
        status: SubscriptionStatus.INACTIVE
      });

      if (!subscription) {
        return reply
          .code(404)
          .send({ 
            statusCode: 404, 
            statusMessage: 'Subscription not found.' 
          });
      }

      // Activate subscription
      const updateResult = await collection?.updateOne({ 
        _id: new ObjectId(id) 
      }, { 
        $set: { status: SubscriptionStatus.ACTIVE } 
      });

      request.log.info({ 
        level: 'info', 
        message: 'Subscription enabled',
        result: updateResult
      })

      return reply
        .code(200)
        .send({ 
          statusCode: 200,
          message: 'Subscription enabled'
        })
    } catch (error) {
      console.log('Enabling subscription failed')
      console.log(error)
      return reply
        .code(500)
        .send({ 
          statusCode: 500, 
          statusMessage: 'Something went wrong' 
        })
    }
  })
}
  
  export default confirmSubscription
  