import { ObjectId } from '@fastify/mongodb';
import type { FastifyPluginAsync } from 'fastify';
import { ActionError, deleteSubscription as deleteAction } from '../lib/subscriptionActions';
import { Generic500Error, type Generic500ErrorType } from '../types/error';

import {
  type SubscriptionCollectionType,
  SubscriptionGenericPostResponse,
  type SubscriptionGenericPostResponseType,
} from '../types/subscription';

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
      const collection = fastify.mongo.db?.collection<SubscriptionCollectionType>('subscription');

      if (!collection) {
        return reply.code(500).send({ statusCode: 500, statusMessage: 'Database not available' });
      }

      try {
        await deleteAction(collection, { _id: new ObjectId(id), hash });
      } catch (error) {
        if (error instanceof ActionError) {
          return reply.code(error.statusCode).send({
            statusCode: error.statusCode,
            statusMessage: error.message,
          });
        }

        throw error;
      }

      fastify.log.info({
        level: 'info',
        message: `Subscription ${id} deleted`,
      });

      return reply.code(200).send({
        statusCode: 200,
        statusMessage: 'Subscription deleted',
      });
    },
  );
};

export default deleteSubscription;
