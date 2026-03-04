import { ObjectId } from '@fastify/mongodb';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { ActionError, renewSubscription as renewAction } from '../lib/subscriptionActions';
import { Generic500Error, type Generic500ErrorType } from '../types/error';

import {
  type SubscriptionCollectionType,
  SubscriptionGenericPostResponse,
  type SubscriptionGenericPostResponseType,
} from '../types/subscription';

// Renews subscription by resetting the created timestamp

const renewSubscription: FastifyPluginAsync = async (fastify: FastifyInstance, _opts: object): Promise<void> => {
  fastify.get<{
    Reply: SubscriptionGenericPostResponseType | Generic500ErrorType;
  }>(
    '/subscription/renew/:id/:hash',
    {
      schema: {
        response: {
          200: SubscriptionGenericPostResponse,
          500: Generic500Error,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const collection = fastify.mongo.db?.collection<SubscriptionCollectionType>('subscription');
      const { id, hash } = request.params as { id: string; hash: string };

      if (!collection) {
        return reply.code(500).send({ statusCode: 500, statusMessage: 'Database not available' });
      }

      try {
        await renewAction(collection, { _id: new ObjectId(id), hash }, fastify.atv);

        return reply.code(200).send({
          statusCode: 200,
          statusMessage: 'Subscription renewed successfully.',
        });
      } catch (error) {
        if (error instanceof ActionError) {
          return reply.code(error.statusCode).send({
            statusCode: error.statusCode,
            statusMessage: error.message,
          });
        }
        throw error;
      }
    },
  );
};

export default renewSubscription;
