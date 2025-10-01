import { 
  FastifyPluginAsync, 
  FastifyReply, 
  FastifyInstance, 
  FastifyRequest
} from 'fastify';

import { ObjectId } from '@fastify/mongodb';
import { 
  Generic500Error, 
  Generic500ErrorType 
} from '../types/error';

import { 
  SubscriptionGenericPostResponse, 
  SubscriptionGenericPostResponseType, 
  SubscriptionStatus
} from '../types/subscription';

  
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
    const mongodb = fastify.mongo;
    const collection = mongodb.db?.collection('subscription');
    const { id, hash } = request.params as { id: string, hash: string };

    const subscription = await collection?.findOne({ 
      _id: new ObjectId(id), 
      hash, 
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
    );

    return reply
      .code(200)
      .header('Content-Type', 'application/json; charset=utf-8')
      .send({
        statusCode: 200,
        statusMessage: 'Subscription enabled.'
      });
  });
};
  
export default confirmSubscription;
