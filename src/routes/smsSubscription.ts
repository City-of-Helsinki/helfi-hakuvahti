import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { Collection, WithId } from 'mongodb';
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader';
import { type SmsAction, verifySmsRequest } from '../lib/smsCode';
import { ActionError, confirmSubscription, deleteSubscription, renewSubscription } from '../lib/subscriptionActions';
import { Generic500Error, type Generic500ErrorType } from '../types/error';
import {
  SmsVerificationRequest,
  type SmsVerificationRequestType,
  SmsVerificationResponse,
  type SmsVerificationResponseType,
  type SubscriptionCollectionType,
} from '../types/subscription';

/**
 * Shared schema for all SMS verification endpoints.
 */
const smsSchema = {
  body: SmsVerificationRequest,
  response: {
    200: SmsVerificationResponse,
    400: SmsVerificationResponse,
    401: SmsVerificationResponse,
    403: SmsVerificationResponse,
    404: SmsVerificationResponse,
    429: SmsVerificationResponse,
    500: Generic500Error,
  },
};

/**
 * Execute the subscription action based on type.
 */
const executeAction = async (
  action: SmsAction,
  collection: Collection<SubscriptionCollectionType>,
  subscription: WithId<SubscriptionCollectionType>,
  fastify: FastifyInstance,
) => {
  const subscriptionId = subscription._id;

  switch (action) {
    case 'confirm':
      return confirmSubscription(collection, { _id: subscriptionId }, 'sms');

    case 'delete':
      return deleteSubscription(collection, { _id: subscriptionId });

    case 'renew':
      return renewSubscription(collection, { _id: subscriptionId }, fastify.atv);
  }
};

/**
 * Create SMS verification handler for a specific action.
 */
const createSmsHandler =
  (action: SmsAction, fastify: FastifyInstance) =>
  async (request: FastifyRequest<{ Body: SmsVerificationRequestType }>, reply: FastifyReply) => {
    const { sms_code, number } = request.body;
    const collection = fastify.mongo.db?.collection<SubscriptionCollectionType>('subscription');

    if (!collection) {
      return reply.code(500).send({ error: 'Database not available' });
    }

    // Find subscription by SMS code.
    // @fixme: we rely on unique short code that is sent
    //   to user as a sms message. This is quite fragile and
    //   easy to enumerate. Be careful!
    const subscription = await collection.findOne({
      sms_code,
      sms_code_created: { $exists: true },
    });

    if (!subscription) {
      return reply.code(404).send({
        statusCode: 404,
        statusMessage: 'Invalid verification code.',
      });
    }

    // Load site configuration and check enableSms
    const siteConfig = SiteConfigurationLoader.getConfiguration(subscription.site_id);
    if (!siteConfig?.subscription.enableSms) {
      return reply.code(403).send({
        statusCode: 403,
        statusMessage: 'SMS verification is not enabled for this site.',
      });
    }

    // Verify SMS code (check expiry + validate phone)
    const verified = await verifySmsRequest(subscription, number, siteConfig, action, fastify.atv);

    if (!verified) {
      return reply.code(401).send({
        statusCode: 401,
        statusMessage: 'Verification failed.',
      });
    }

    // Execute action
    try {
      await executeAction(action, collection, subscription, fastify);

      fastify.log.info({
        level: 'info',
        message: `Subscription ${subscription._id} ${action}ed via SMS`,
      });

      return reply.code(200).send();
    } catch (error) {
      if (error instanceof ActionError) {
        return reply.code(error.statusCode).send({
          statusCode: error.statusCode,
          statusMessage: error.message,
        });
      }
      throw error;
    }
  };

/**
 * SMS-based subscription actions.
 * - POST /subscription/confirm/sms
 * - POST /subscription/delete/sms
 * - POST /subscription/renew/sms
 */
const smsSubscription: FastifyPluginAsync = async (fastify: FastifyInstance, _opts: object): Promise<void> => {
  fastify.post<{
    Body: SmsVerificationRequestType;
    Reply: SmsVerificationResponseType | Generic500ErrorType;
  }>('/subscription/confirm/sms', { schema: smsSchema }, createSmsHandler('confirm', fastify));

  fastify.post<{
    Body: SmsVerificationRequestType;
    Reply: SmsVerificationResponseType | Generic500ErrorType;
  }>('/subscription/delete/sms', { schema: smsSchema }, createSmsHandler('delete', fastify));

  fastify.post<{
    Body: SmsVerificationRequestType;
    Reply: SmsVerificationResponseType | Generic500ErrorType;
  }>('/subscription/renew/sms', { schema: smsSchema }, createSmsHandler('renew', fastify));
};

export default smsSubscription;
