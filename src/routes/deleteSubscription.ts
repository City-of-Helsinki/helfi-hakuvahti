import { ObjectId } from '@fastify/mongodb';
import type { FastifyPluginAsync } from 'fastify';
import { Generic500Error, type Generic500ErrorType } from '../types/error';

import { SubscriptionGenericPostResponse, type SubscriptionGenericPostResponseType } from '../types/subscription';

// Deletes subscription
const deleteSubscription: FastifyPluginAsync = async (fastify, _opts) => {
  fastify.delete<{
    Reply: SubscriptionGenericPostResponseType | Generic500ErrorType;
  }>(
    '/subscription/delete/:id/:hash',
    {
      schema: {
        response: {
          200: SubscriptionGenericPostResponse,
          500: Generic500Error,
        },
      },
    },
    async (request, reply) => {
      const { id, hash } = request.params as { id: string; hash: string };

      // Delete subscription if client knows object id and hash.
      const result = await fastify.mongo.db?.collection('subscription')?.deleteOne({ _id: new ObjectId(id), hash });

      if (result?.deletedCount === 0) {
        return reply.code(404).send({
          statusCode: 404,
          statusMessage: 'Subscription not found.',
        });
      } else {
        fastify.log.info({
          level: 'info',
          message: `Subscription ${id} deleted`,
          result,
        });

        return reply.code(200).send({
          statusCode: 200,
          statusMessage: 'Subscription deleted',
        });
      }
    },
  );
};

export default deleteSubscription;
