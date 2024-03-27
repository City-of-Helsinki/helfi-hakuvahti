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

    await collection!.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: SubscriptionStatus.ACTIVE } },
    )

    return reply
      .code(200)
      .send({ message: 'Subscription enabled' })
  })
}
  
export default confirmSubscription
