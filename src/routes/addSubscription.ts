import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { confirmationEmail } from '../lib/email';
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader';
import { generateUniqueSmsCode } from '../lib/smsCode';
import { Generic400Error, type Generic400ErrorType, Generic500Error, type Generic500ErrorType } from '../types/error';
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
    Reply: SubscriptionResponseType | Generic400ErrorType | Generic500ErrorType;
  }>(
    '/subscription',
    {
      schema: {
        body: SubscriptionRequest,
        response: {
          200: SubscriptionResponse,
          400: Generic400Error,
          500: Generic500Error,
        },
      },
      preValidation: (request, reply, done) => {
        // Validate email and SMS BEFORE ATV document creation
        // preValidation runs BEFORE preHandler (where ATV storage happens)
        const email = request.body.email?.trim();
        const sms = request.body.sms?.trim();

        if (!isValidEmail(email)) {
          reply.code(400);
          return done(new Error('Invalid email format.'));
        }

        if (sms && !isValidSms(sms)) {
          reply.code(400);
          return done(new Error('Invalid email format.'));
        }

        done();
      },
    },
    async (request: FastifyRequest<{ Body: SubscriptionRequestType }>, reply: FastifyReply) => {
      const mongodb = fastify.mongo;
      const collection = mongodb.db?.collection('subscription');
      const hash = fastify.getRandHash();

      // Check if elastic query validation failed
      if (request.elasticQueryValidation && !request.elasticQueryValidation.isValid) {
        return reply
          .code(400)
          .header('Content-Type', 'application/json; charset=utf-8')
          .send({
            error: `Invalid elastic_query: ${request.elasticQueryValidation.error || 'Query validation failed'}`,
          });
      }

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
      const now = new Date();
      const deleteAfter = new Date(now);
      deleteAfter.setDate(deleteAfter.getDate() + siteConfig.subscription.maxAge);

      const subscriptionData: Partial<SubscriptionCollectionType> = {
        ...request.body,
        hash,
        created: now,
        modified: now,
        last_checked: Math.floor(Date.now() / 1000),
        expiry_notification_sent: SubscriptionStatus.INACTIVE,
        status: SubscriptionStatus.INACTIVE,
        has_sms: !!request.atvResponse?.hasSms,
        delete_after: deleteAfter,
      };

      // Generate SMS code if SMS is enabled for this subscription and site
      if (subscriptionData.has_sms && siteConfig.subscription.enableSms) {
        const smsCode = await generateUniqueSmsCode(collection);
        subscriptionData.sms_code = smsCode;
        subscriptionData.sms_code_created = now;
      }

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
          search_description: subscriptionData.search_description,
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
