import { randomInt } from 'node:crypto';
import { ObjectId } from '@fastify/mongodb';
import type { FastifyPluginAsync } from 'fastify';
import { ActionError, deleteSubscription as deleteAction } from '../lib/subscriptionActions';
import { Generic500Error, type Generic500ErrorType } from '../types/error';
import { SubscriptionGenericPostResponse, type SubscriptionGenericPostResponseType } from '../types/subscription';

// Deletes subscription
const deleteSubscription: FastifyPluginAsync = async (fastify, _opts) => {
  fastify.delete<{
    Params: { id: string; hash: string };
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
      const { id, hash } = request.params;

      try {
        await deleteAction(fastify.mongo.db?.collection('subscription'), { _id: new ObjectId(id), hash });
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

  /**
   * This endpoint does not ask for any secrets from the user.
   * We assume that database id and rate limiting are enough to
   * secure the endpoint.
   *
   * Caller MUST rate limit this endpoint.
   */
  fastify.delete<{
    Params: { id: string };
    Reply: SubscriptionGenericPostResponseType | Generic500ErrorType;
  }>(
    '/subscription/sms/delete/:id',
    {
      schema: {
        response: {
          200: SubscriptionGenericPostResponse,
          500: Generic500Error,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      try {
        await deleteAction(fastify.mongo.db?.collection('subscription'), { _id: new ObjectId(id) });
      } catch (error) {
        if (error instanceof ActionError) {
          return reply.code(error.statusCode).send({
            // @fixme statusCode is totally useless.
            statusCode: randomInt(0, 1000),
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
        // @fixme statusCode is totally useless.
        statusCode: randomInt(0, 1000),
        statusMessage: 'Subscription deleted',
      });
    },
  );
};

export default deleteSubscription;
