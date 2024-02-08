import { 
  FastifyPluginAsync, 
  FastifyReply, 
  FastifyInstance, 
  FastifyRequest
} from 'fastify';

import { 
  Generic500Error, 
  Generic500ErrorType 
} from '../types/error';

import { 
  SubscriptionGenericPostResponse, 
  SubscriptionGenericPostResponseType 
} from '../types/subscription';
import { ObjectId } from '@fastify/mongodb';

// Deletes subscription

const deleteSubscription: FastifyPluginAsync = async (
  fastify: FastifyInstance,
  opts: object
): Promise<void> => {
  fastify.delete<{
    Reply: SubscriptionGenericPostResponseType | Generic500ErrorType
  }>('/subscription/delete/:id/:hash', {
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
    const { id, hash } = <{ id: string, hash: string }>request.params;

    try {
      const result = await collection?.deleteOne({ _id: new ObjectId(id), hash: hash });

      request.log.info({ 
        level: 'info', 
        message: 'Subscription deleted',
        result: result
      });

      if (result?.deletedCount === 0) {
        return reply
          .code(404)
          .send({ 
            statusCode: 404, 
            statusMessage: 'Subscription not found.' 
          });
      }

      return reply
        .code(200)
        .send({ 
          statusCode: 200,
          message: 'Subscription deleted'
        });
    } catch (error) {
      console.log('Subscription deletion failed')
      console.log(error)
      return reply
        .code(500)
        .send({ 
          statusCode: 500, 
          statusMessage: 'Something went wrong' 
        });
    }
  });
};

export default deleteSubscription;
