import { ObjectId } from '@fastify/mongodb';
import type { FastifyPluginAsync } from 'fastify';
import { verifySms } from '../lib/email';
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader';
import { generateSmsCode } from '../lib/smsCode';
import { Generic500Error, type Generic500ErrorType } from '../types/error';
import type { QueueInsertDocument } from '../types/queue';
import {
  SmsVerificationResponse,
  type SmsVerificationResponseType,
  type SubscriptionCollectionType,
} from '../types/subscription';

/**
 * SMS-based subscription verification.
 * POST /subscription/sms/verify/:id - Generate and send a verification code via SMS.
 */
const smsSubscription: FastifyPluginAsync = async (fastify, _opts) => {
  fastify.post<{
    Params: { id: string };
    Reply: SmsVerificationResponseType | Generic500ErrorType;
  }>(
    '/subscription/sms/verify/:id',
    {
      schema: {
        response: {
          200: SmsVerificationResponse,
          403: SmsVerificationResponse,
          404: SmsVerificationResponse,
          500: Generic500Error,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      const subscription = await fastify.mongo.db
        ?.collection<SubscriptionCollectionType>('subscription')
        ?.findOne({ _id: new ObjectId(id) });

      if (!subscription) {
        return reply.code(404).send({
          statusCode: 404,
          statusMessage: 'Subscription not found',
        });
      }

      const site = SiteConfigurationLoader.getConfiguration(subscription.site_id);
      if (!site?.subscription?.enableSms) {
        return reply.code(403).send({
          statusCode: 403,
          statusMessage: 'SMS verification is not enabled for this site.',
        });
      }

      if (!subscription.atv_id) {
        return reply.code(500).send({
          statusCode: 500,
          statusMessage: 'Subscription has no ATV document.',
        });
      }

      // Generate TOTP-like code
      const code = generateSmsCode(subscription.sms_secret);

      // Queue SMS for sending
      const smsContent = await verifySms(subscription.lang, { code }, site);
      const document: QueueInsertDocument = {
        type: 'sms',
        atv_id: subscription.atv_id,
        content: smsContent,
      };

      await fastify.mongo.db?.collection('queue')?.insertOne(document);

      fastify.log.info({
        message: `Verification SMS queued for subscription ${subscription._id}`,
      });

      return reply.code(200).send({
        statusCode: 200,
        statusMessage: 'Verification code sent.',
      });
    },
  );
};

export default smsSubscription;
