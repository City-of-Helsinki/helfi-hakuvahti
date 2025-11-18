import { ObjectId } from '@fastify/mongodb';
import type { FastifyPluginAsync } from 'fastify';
import { Generic500Error, type Generic500ErrorType, GenericResponse, type GenericResponseType } from '../types/error';

import {
  SubscriptionStatus,
  SubscriptionStatusResponse,
  type SubscriptionStatusResponseType,
} from '../types/subscription';

// Checks subscription status
const subscriptionStatus: FastifyPluginAsync = async (fastify, _opts) => {
  fastify.get<{
    Reply: SubscriptionStatusResponseType | GenericResponseType | Generic500ErrorType;
  }>(
    '/subscription/status/:id/:hash',
    {
      schema: {
        response: {
          200: SubscriptionStatusResponse,
          404: GenericResponse,
          500: Generic500Error,
        },
      },
    },
    async (request, reply) => {
      const { id, hash } = request.params as { id: string; hash: string };

      const subscription = await fastify.mongo.db?.collection('subscription')?.findOne({
        _id: new ObjectId(id),
        hash,
      });

      if (!subscription) {
        return reply.code(404).send({
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
