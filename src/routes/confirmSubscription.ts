import { ObjectId } from '@fastify/mongodb';
import type { FastifyPluginAsync } from 'fastify';
import { ActionError, confirmSubscription as confirmAction } from '../lib/subscriptionActions';
import { Generic500Error, type Generic500ErrorType } from '../types/error';

import {
  type SubscriptionCollectionType,
  SubscriptionGenericPostResponse,
  type SubscriptionGenericPostResponseType,
} from '../types/subscription';

// Confirms subscription
const confirmSubscription: FastifyPluginAsync = async (fastify, _opts) => {
  // @fixme change request type to post.
  fastify.get<{
    Reply: SubscriptionGenericPostResponseType | Generic500ErrorType;
  }>(
    '/subscription/confirm/:id/:hash',
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
        await confirmAction(collection, { _id: new ObjectId(id), hash }, 'email');
      } catch (error) {
        if (error instanceof ActionError) {
          return reply.code(error.statusCode).header('Content-Type', 'application/json; charset=utf-8').send({
            statusCode: error.statusCode,
            statusMessage: error.message,
          });
        }

        throw error;
      }

      fastify.log.info({
        level: 'info',
        message: `Subscription ${id} confirmed`,
      });

      return reply.code(200).header('Content-Type', 'application/json; charset=utf-8').send({
        statusCode: 200,
        statusMessage: 'Subscription enabled.',
      });
    },
  );
};

export default confirmSubscription;
