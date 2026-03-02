import { ObjectId } from '@fastify/mongodb';
import type { FastifyPluginAsync } from 'fastify';
import { Generic500Error, type Generic500ErrorType } from '../types/error';

import {
  SubscriptionGenericPostResponse,
  type SubscriptionGenericPostResponseType,
  SubscriptionStatus,
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

      // Set status to active if the client known object id and hash value.
      const response = await fastify.mongo.db?.collection('subscription')?.updateOne(
        {
          _id: new ObjectId(id),
          hash,
          email_confirmed: false,
        },
        { $set: { status: SubscriptionStatus.ACTIVE, email_confirmed: true } },
      );

      if (response?.modifiedCount) {
        fastify.log.info({
          level: 'info',
          message: `Subscription ${id} confirmed`,
        });

        return reply.code(200).header('Content-Type', 'application/json; charset=utf-8').send({
          statusCode: 200,
          statusMessage: 'Subscription enabled.',
        });
      } else {
        return reply.code(404).header('Content-Type', 'application/json; charset=utf-8').send({
          statusCode: 404,
          statusMessage: 'Subscription not found.',
        });
      }
    },
  );
};

export default confirmSubscription;
