import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { confirmationEmail } from '../lib/email';
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader';
import { Generic500Error, type Generic500ErrorType } from '../types/error';
import type { QueueInsertDocumentType } from '../types/mailer';
import {
  type SubscriptionCollectionType,
  SubscriptionRequest,
  type SubscriptionRequestType,
  SubscriptionResponse,
  type SubscriptionResponseType,
  SubscriptionStatus,
} from '../types/subscription';

// Validation helpers
const isValidEmail = (email: string): boolean => {
  const re =
    /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(String(email).toLowerCase());
};

const isValidSms = (sms: string): boolean => {
  // E.164 international format: + followed by 1-15 digits
  const re = /^\+[1-9]\d{1,14}$/;
  return re.test(sms);
};

// Add subscription to given query parameters

const subscription: FastifyPluginAsync = async (fastify: FastifyInstance, _opts: object): Promise<void> => {
  fastify.post<{
    Body: SubscriptionRequestType;
    Reply: SubscriptionResponseType | Generic500ErrorType;
  }>(
    '/subscription',
    {
      schema: {
        body: SubscriptionRequest,
        response: {
          200: SubscriptionResponse,
          500: Generic500Error,
        },
      },
      preValidation: async (request: FastifyRequest<{ Body: SubscriptionRequestType }>, reply: FastifyReply) => {
        // Validate email and SMS BEFORE ATV document creation
        // preValidation runs BEFORE preHandler (where ATV storage happens)
        const email = request.body.email?.trim();
        const sms = request.body.sms?.trim();

        if (!isValidEmail(email)) {
          return reply
            .code(400)
            .header('Content-Type', 'application/json; charset=utf-8')
            .send({ error: 'Invalid email format.' });
        }

        if (sms && !isValidSms(sms)) {
          return reply
            .code(400)
            .header('Content-Type', 'application/json; charset=utf-8')
            .send({ error: 'Invalid SMS format. Use international format (e.g., +358451234567).' });
        }
      },
    },
    async (request: FastifyRequest<{ Body: SubscriptionRequestType }>, reply: FastifyReply) => {
      const mongodb = fastify.mongo;
      const collection = mongodb.db?.collection('subscription');
      const hash = fastify.getRandHash();

      // Replace email in request with ATV hashed email
      if (!request?.atvResponse?.atvDocumentId)
        return reply
          .code(500)
          .header('Content-Type', 'application/json; charset=utf-8')
          .send({ error: 'Could not find hashed email. Subscription not added.' });
      request.body.email = request.atvResponse.atvDocumentId;

      // Load site configuration
      const configLoader = SiteConfigurationLoader.getInstance();
      await configLoader.loadConfigurations();
      const siteConfig = configLoader.getConfiguration(request.body.site_id);

      if (!siteConfig) {
        return reply
          .code(400)
          .header('Content-Type', 'application/json; charset=utf-8')
          .send({ error: 'Invalid site_id provided.' });
      }

      // Subscription data that goes to collection
      const subscriptionData: Partial<SubscriptionCollectionType> = {
        ...request.body,
        hash,
        created: new Date(),
        modified: new Date(),
        last_checked: Math.floor(Date.now() / 1000),
        expiry_notification_sent: SubscriptionStatus.INACTIVE,
        status: SubscriptionStatus.INACTIVE,
        has_sms: !!request.atvResponse?.hasSms,
      };

      // SMS is already stored in ATV document, no need to store in MongoDB
      // It was removed by the ATV hook after validation

      const response = await collection?.insertOne(subscriptionData);
      if (!response) {
        fastify.log.debug(response);

        throw new Error('Adding new subscription failed. See logs.');
      }

      // Insert email in queue
      const langKey = request.body.lang.toLowerCase() as keyof typeof siteConfig.urls;
      const subscribeLinkBase = langKey in siteConfig.urls ? siteConfig.urls[langKey] : siteConfig.urls.base;
      const emailContent = await confirmationEmail(
        request.body.lang,
        {
          link: `${subscribeLinkBase}/hakuvahti/confirm?subscription=${response.insertedId}&hash=${hash}`,
        },
        siteConfig,
      );

      // Email data to queue
      const email: QueueInsertDocumentType = {
        email: request.body.email,
        content: emailContent,
      };

      const q = mongodb.db?.collection('queue');
      await q?.insertOne(email);

      fastify.log.debug(emailContent);

      return reply.code(200).header('Content-Type', 'application/json; charset=utf-8').send(response);
    },
  );
};

export default subscription;
