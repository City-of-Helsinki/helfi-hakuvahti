import { ObjectId } from '@fastify/mongodb';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { Generic500Error, type Generic500ErrorType } from '../types/error';

import {
  SubscriptionStatusResponse,
  type SubscriptionStatusResponseType,
  SubscriptionStatus,
} from '../types/subscription';

// Checks subscription status

const subscriptionStatus: FastifyPluginAsync = async (fastify: FastifyInstance, _opts: object): Promise<void> => {
  fastify.get<{
    Reply: SubscriptionStatusResponseType | Generic500ErrorType;
  }>(
    '/subscription/status/:id/:hash',
    {
      schema: {
        response: {
          200: SubscriptionStatusResponse,
          500: Generic500Error,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const mongodb = fastify.mongo;
      const collection = mongodb.db?.collection('subscription');
      const { id, hash } = request.params as { id: string; hash: string };

      const subscription = await collection?.findOne({
        _id: new ObjectId(id),
        hash,
      });

      if (!subscription) {
        return reply.code(404).send({
          statusCode: 404,
          statusMessage: 'Subscription not found.',
        });
      }

      // Map numeric status to text value
      let statusText: 'active' | 'inactive' | 'disabled';
      switch (subscription.status) {
        case SubscriptionStatus.ACTIVE:
          statusText = 'active';
          break;
        case SubscriptionStatus.INACTIVE:
          statusText = 'inactive';
          break;
        case SubscriptionStatus.DISABLED:
          statusText = 'disabled';
          break;
        default:
          statusText = 'inactive';
      }

      return reply.code(200).header('Content-Type', 'application/json; charset=utf-8').send({
        subscriptionStatus: statusText,
      });
    },
  );
};

export default subscriptionStatus;
