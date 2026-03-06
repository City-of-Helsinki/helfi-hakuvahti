import { randomInt } from 'node:crypto';
import { ObjectId } from '@fastify/mongodb';
import type { FastifyPluginAsync } from 'fastify';
import { findAndVerifySmsSubscription } from '../lib/smsCode';
import { ActionError, renewSubscription as renewAction } from '../lib/subscriptionActions';
import { Generic500Error, type Generic500ErrorType } from '../types/error';
import {
  type SmsVerificationRequestType,
  type SubscriptionCollectionType,
  SubscriptionGenericPostResponse,
  type SubscriptionGenericPostResponseType,
} from '../types/subscription';

// Renews subscription by resetting the created timestamp

const renewSubscription: FastifyPluginAsync = async (fastify, _opts) => {
  fastify.post<{
    Params: { id: string; hash: string };
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
    async (request, reply) => {
      const { id, hash } = request.params;

      try {
        await renewAction(fastify.mongo.db?.collection('subscription'), { _id: new ObjectId(id), hash }, fastify.atv);
      } catch (error) {
        if (error instanceof ActionError) {
          return reply.code(error.statusCode).send({
            statusCode: error.statusCode,
            statusMessage: error.message,
          });
        }
        throw error;
      }

      return reply.code(200).send({
        statusCode: 200,
        statusMessage: 'Subscription renewed successfully.',
      });
    },
  );

  /**
   * Caller MUST rate limit this endpoint.
   */
  fastify.post<{
    Params: { id: string };
    Body: SmsVerificationRequestType;
    Reply: SubscriptionGenericPostResponseType | Generic500ErrorType;
  }>(
    '/subscription/sms/renew/:id',
    {
      schema: {
        response: {
          200: SubscriptionGenericPostResponse,
          500: Generic500Error,
        },
      },
    },
    async (request, reply) => {
      const collection = fastify.mongo.db?.collection<SubscriptionCollectionType>('subscription');
      const { id } = request.params;
      const { sms_code } = request.body;

      const verified = await findAndVerifySmsSubscription(collection, id, sms_code);

      if (!verified) {
        return reply.code(400).send({
          // @fixme statusCode is totally useless.
          statusCode: randomInt(0, 1000),
          statusMessage: 'Invalid SMS code.',
        });
      }

      try {
        await renewAction(collection, { _id: new ObjectId(id) }, fastify.atv);
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

      return reply.code(200).send({
        // @fixme statusCode is totally useless.
        statusCode: randomInt(0, 1000),
        statusMessage: 'Subscription renewed successfully.',
      });
    },
  );
};

export default renewSubscription;
