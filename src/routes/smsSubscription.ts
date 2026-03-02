import type { ObjectId } from '@fastify/mongodb';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { Collection } from 'mongodb';
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader';
import { findSubscriptionByCode, type SmsAction, verifySmsRequest } from '../lib/smsCode';
import { confirmSubscription, deleteSubscription, renewSubscription } from '../lib/subscriptionActions';
import { Generic500Error, type Generic500ErrorType } from '../types/error';
import type { SiteConfigurationType } from '../types/siteConfig';
import {
  SmsVerificationRequest,
  type SmsVerificationRequestType,
  SmsVerificationResponse,
  type SmsVerificationResponseType,
  type SubscriptionStatus,
  type VerificationSubscriptionType,
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
  collection: Collection,
  subscription: VerificationSubscriptionType,
  siteConfig: SiteConfigurationType,
  fastify: FastifyInstance,
) => {
  const subscriptionId = subscription._id as ObjectId;

  switch (action) {
    case 'confirm':
      return confirmSubscription(collection, subscriptionId);

    case 'delete':
      return deleteSubscription(collection, subscriptionId);

    case 'renew': {
      const subscriptionDoc = {
        _id: subscriptionId,
        email: subscription.email,
        atv_id: subscription.atv_id,
        site_id: subscription.site_id,
        status: subscription.status as SubscriptionStatus,
        created: new Date(subscription.created as Date),
        first_created: subscription.first_created ? new Date(subscription.first_created as Date) : undefined,
      };
      return renewSubscription(collection, subscriptionDoc, siteConfig, fastify.atvUpdateDocumentDeleteAfter);
    }
  }
};

/**
 * Create SMS verification handler for a specific action.
 */
const createSmsHandler =
  (action: SmsAction, fastify: FastifyInstance) =>
  async (request: FastifyRequest<{ Body: SmsVerificationRequestType }>, reply: FastifyReply) => {
    const { sms_code, number } = request.body;
    const collection = fastify.mongo.db?.collection('subscription');

    if (!collection) {
      return reply.code(500).send({ error: 'Database not available' });
    }

    // Find subscription by SMS code
    const subscription = await findSubscriptionByCode(collection, sms_code);
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
    const verified = await verifySmsRequest(subscription, number, siteConfig, action, fastify.atvGetDocument);

    if (!verified) {
      return reply.code(401).send({
        statusCode: 401,
        statusMessage: 'Verification failed.',
      });
    }

    // Execute action
    const result = await executeAction(action, collection, subscription, siteConfig, fastify);

    if (result.success) {
      fastify.log.info({
        level: 'info',
        message: `Subscription ${subscription._id} ${action}ed via SMS`,
      });
    }

    return reply.code(result.statusCode).send({
      statusCode: result.statusCode,
      statusMessage: result.statusMessage,
      expiryDate: result.expiryDate,
    });
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
