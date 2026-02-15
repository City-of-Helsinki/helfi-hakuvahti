import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import libphonenumber from 'google-libphonenumber';
import { confirmationEmail, confirmationSms } from '../lib/email';
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader';
import { generateUniqueSmsCode } from '../lib/smsCode';
import { atvCreateDocument } from '../plugins/atv';
import type { AtvDocumentType } from '../types/atv';
import { Generic400Error, type Generic400ErrorType, Generic500Error, type Generic500ErrorType } from '../types/error';
import type { QueueInsertDocumentType } from '../types/mailer';
import type { SmsQueueInsertDocumentType } from '../types/sms';
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

const phoneUtil = libphonenumber.PhoneNumberUtil.getInstance();

const parsePhoneNumber = (sms: string): string => {
  const parsed = phoneUtil.parse(sms, 'FI');
  if (!phoneUtil.isValidNumber(parsed)) {
    throw new Error('Invalid phone number.');
  }
  return phoneUtil.format(parsed, libphonenumber.PhoneNumberFormat.E164);
};

/**
 * Stores user data in ATV.
 */
async function storeUserData(body: SubscriptionRequestType) {
  const email = body.email?.trim();
  const phone = body.sms?.trim();

  let atvDocument: Partial<AtvDocumentType>;

  try {
    atvDocument = await atvCreateDocument(
      {
        ...(email && { email: email }),
        ...(phone && { sms: phone }),
      },
      'atvCreateDocumentWithEmail',
    );
  } catch (error) {
    throw new Error('Could not create document to ATV.', {
      cause: error,
    });
  }

  if (!atvDocument || !atvDocument.id) {
    throw new Error('Could not create document to ATV.');
  }

  return atvDocument.id;
}

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

        if (!email && !sms) {
          return reply.code(400).send({ error: 'Either email or sms is required.', field: 'email' });
        }

        if (email && !isValidEmail(email)) {
          return reply.code(400).send({ error: 'Invalid email format.', field: 'email' });
        }

        if (sms) {
          try {
            // Normalize the phone number to E.164 format.
            request.body.sms = parsePhoneNumber(sms);
          } catch {
            return reply.code(400).send({ error: 'Invalid phone number format.', field: 'sms' });
          }
        }

        done();
      },
    },
    async (request: FastifyRequest<{ Body: SubscriptionRequestType }>, reply: FastifyReply) => {
      const mongodb = fastify.mongo;
      const collection = mongodb.db?.collection('subscription');
      const hash = fastify.getRandHash();

      // Check if elastic query validation failed.
      // These checks are run in a plugin that writes
      // results to request globals.
      if (request.elasticQueryValidation && !request.elasticQueryValidation.isValid) {
        return reply
          .code(400)
          .header('Content-Type', 'application/json; charset=utf-8')
          .send({
            error: `Invalid elastic_query: ${request.elasticQueryValidation.error || 'Query validation failed'}`,
          });
      }

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

      const hasSms = !!siteConfig.subscription?.enableSms && !!request.body.sms;
      const hasEmail = !!request.body.email;

      // Store user data in ATV.
      try {
        const atvId = await storeUserData(request.body);

        // Remove user data from request body.
        delete request.body.sms;
        delete request.body.email;

        // @fixme: email is confusing field name for ATV id.
        // Replace email in request with ATV id
        request.body.email = atvId;
      } catch {
        return reply
          .code(500)
          .header('Content-Type', 'application/json; charset=utf-8')
          .send({ error: 'Could not find hashed email. Subscription not added.' });
      }

      // Store user query to ATV on callee request.
      // The query itself might contain user data that we must store in ATV.
      const elasticQueryAtv = request.body.elastic_query_atv;
      if (elasticQueryAtv) {
        const atvDocument = await fastify.atvCreateDocument(
          {
            elastic_query: request.body.elastic_query,
          },
          'atvCreateDocumentWithQuery',
        );
        if (atvDocument.id) {
          request.body.elastic_query = atvDocument.id;
        } else {
          return reply
            .code(500)
            .header('Content-Type', 'application/json; charset=utf-8')
            .send({ error: 'Could not create ATV document for query. Subscription not added.' });
        }
      }

      // Subscription data that goes to collection.
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
        has_sms: hasSms,
        has_email: hasEmail,
        delete_after: deleteAfter,
      };

      // Generate SMS code if SMS is enabled for this subscription and site
      if (hasSms) {
        subscriptionData.sms_code = await generateUniqueSmsCode(collection);
        subscriptionData.sms_code_created = now;
      }

      const response = await collection?.insertOne(subscriptionData);
      if (!response) {
        fastify.log.debug(response);

        throw new Error('Adding new subscription failed. See logs.');
      }

      const subscribeLinkBase =
        request.body.lang in siteConfig.urls ? siteConfig.urls[request.body.lang] : siteConfig.urls.base;

      // @todo Should we do error handling for notifications?
      // What to do if sending notifications fails? At that point, all user
      // data is already stored in ATV, but the user has no way to enable
      // the subscription.
      await Promise.all([
        // Queue email confirmation:
        hasEmail &&
          (async () => {
            const document: QueueInsertDocumentType = {
              // NOTE: email is replaced with ATV document id. Yes, this is confusing.
              email: request.body.email ?? '',
              content: await confirmationEmail(
                request.body.lang,
                {
                  link: `${subscribeLinkBase}/hakuvahti/confirm?subscription=${response.insertedId}&hash=${hash}`,
                  search_description: request.body.search_description,
                },
                siteConfig,
              ),
            };

            return mongodb.db?.collection('queue')?.insertOne(document);
          })(),

        // Queue sms confirmation:
        hasSms &&
          (async () => {
            const document: SmsQueueInsertDocumentType = {
              // NOTE: email is replaced with ATV document id. Yes, this is confusing.
              sms: request.body.email ?? '',
              content: await confirmationSms(
                request.body.lang,
                {
                  // @todo: placeholder URL. See: https://helsinkisolutionoffice.atlassian.net/browse/UHF-12837.
                  link: `${subscribeLinkBase}/hakuvahti/confirm/phone`,
                  search_description: request.body.search_description,
                  sms_code: subscriptionData.sms_code ?? '',
                },
                siteConfig,
              ),
            };

            return mongodb.db?.collection('smsqueue')?.insertOne(document);
          })(),
      ]);

      return reply.code(200).header('Content-Type', 'application/json; charset=utf-8').send(response);
    },
  );
};

export default subscription;
