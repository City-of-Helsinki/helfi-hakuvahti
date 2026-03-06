import { randomInt } from 'node:crypto';
import { ObjectId } from '@fastify/mongodb';
import type { FastifyPluginAsync } from 'fastify';
import { findAndVerifySmsSubscription } from '../lib/smsCode';
import { ActionError, confirmSubscription as confirmAction } from '../lib/subscriptionActions';
import { Generic500Error, type Generic500ErrorType } from '../types/error';
import {
  type SmsVerificationRequestType,
  SmsVerificationResponse,
  type SubscriptionCollectionType,
  SubscriptionGenericPostResponse,
  type SubscriptionGenericPostResponseType,
} from '../types/subscription';

// Confirms subscription
const confirmSubscription: FastifyPluginAsync = async (fastify, _opts) => {
  fastify.post<{
    Params: { id: string; hash: string };
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
      const { id, hash } = request.params;
      try {
        await confirmAction(
          fastify.mongo.db?.collection<SubscriptionCollectionType>('subscription'),
          { _id: new ObjectId(id), hash },
          'email',
        );
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

  /**
   * Caller MUST rate limit this endpoint.
   */
  fastify.post<{
    Body: SmsVerificationRequestType;
    Params: { id: string };
    Reply: SubscriptionGenericPostResponseType | Generic500ErrorType;
  }>(
    '/subscription/sms/confirm/:id',
    {
      schema: {
        response: {
          200: SubscriptionGenericPostResponse,
          400: SmsVerificationResponse,
          500: Generic500Error,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { sms_code } = request.body;

      const verified = await findAndVerifySmsSubscription(fastify.mongo.db?.collection('subscription'), id, sms_code);

      if (!verified) {
        return reply.code(400).send({
          // @fixme statusCode is totally useless.
          statusCode: randomInt(0, 1000),
          statusMessage: 'Invalid SMS code.',
        });
      }

      try {
        await confirmAction(fastify.mongo.db?.collection('subscription'), { _id: new ObjectId(id) }, 'sms');
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
        message: `Subscription ${id} confirmed`,
      });

      return reply.code(200).send({
        // @fixme statusCode is totally useless.
        statusCode: randomInt(0, 1000),
        statusMessage: 'Subscription enabled.',
      });
    },
  );
};

export default confirmSubscription;
