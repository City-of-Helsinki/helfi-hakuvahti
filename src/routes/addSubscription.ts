import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import libphonenumber from 'google-libphonenumber';
import type { ATV } from '../lib/atv';
import { confirmationEmail, confirmationSms } from '../lib/email';
import { getRandHash } from '../lib/randhash';
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader';
import { Generic400Error, type Generic400ErrorType, Generic500Error, type Generic500ErrorType } from '../types/error';
import type { QueueInsertDocument } from '../types/queue';
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
 * Stores user data in ATV and returns the document ID.
 */
async function storeUserData(atv: ATV, body: SubscriptionRequestType): Promise<string> {
  const email = body.email?.trim();
  const phone = body.sms?.trim();

  const content: Record<string, string> = {
    ...(email && { email }),
    ...(phone && { sms: phone }),
    ...(body.user_data_in_atv && {
      elastic_query: body.elastic_query,
      query: body.query,
      ...(body.search_description && { search_description: body.search_description }),
    }),
  };

  const atvDocument = await atv.createDocument(content, 'atvCreateDocumentWithEmail');

  if (!atvDocument?.id) {
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
      preValidation: (request, reply, done): void => {
        // Validate email and SMS BEFORE ATV document creation
        // preValidation runs BEFORE preHandler (where ATV storage happens)
        const email = request.body.email?.trim();
        const sms = request.body.sms?.trim();

        if (!email && !sms) {
          reply.code(400).send({ error: 'Either email or sms is required.', field: 'email' });
          done();
          return;
        }

        if (email && !isValidEmail(email)) {
          reply.code(400).send({ error: 'Invalid email format.', field: 'email' });
          done();
          return;
        }

        if (sms) {
          try {
            // Normalize the phone number to E.164 format.
            request.body.sms = parsePhoneNumber(sms);
          } catch {
            reply.code(400).send({ error: 'Invalid phone number format.', field: 'sms' });
            done();
            return;
          }
        }

        done();
        return;
      },
    },
    async (request: FastifyRequest<{ Body: SubscriptionRequestType }>, reply: FastifyReply) => {
      const mongodb = fastify.mongo;
      const collection = mongodb.db?.collection('subscription');
      const hash = getRandHash();

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
      const siteConfig = SiteConfigurationLoader.getConfiguration(request.body.site_id);

      if (!siteConfig) {
        return reply
          .code(400)
          .header('Content-Type', 'application/json; charset=utf-8')
          .send({ error: 'Invalid site_id provided.' });
      }

      const hasSms = !!siteConfig.subscription?.enableSms && !!request.body.sms;
      const hasEmail = !!request.body.email;

      // Store user data (and optionally the elastic query) in a single ATV document.
      let atvId: string;
      try {
        atvId = await storeUserData(fastify.atv, request.body);
      } catch {
        return reply
          .code(500)
          .header('Content-Type', 'application/json; charset=utf-8')
          .send({ error: 'Could not find hashed email. Subscription not added.' });
      }

      // Subscription data that goes to collection.
      const now = new Date();
      const deleteAfter = new Date(now);
      deleteAfter.setDate(deleteAfter.getDate() + siteConfig.subscription.maxAge);

      const subscriptionData: SubscriptionCollectionType = {
        email: hasEmail ? atvId : '',
        elastic_query: request.body.user_data_in_atv ? '' : request.body.elastic_query,
        user_data_in_atv: request.body.user_data_in_atv,
        query: request.body.user_data_in_atv ? '' : request.body.query,
        search_description: request.body.user_data_in_atv ? '' : request.body.search_description,
        site_id: request.body.site_id,
        lang: request.body.lang,
        // Links to the ATV document that stores user data.
        atv_id: atvId,
        hash,
        // Created = when the subscription is last renewed.
        created: now,
        // First created = when the subscription is created.
        first_created: now,
        modified: now,
        last_checked: Math.floor(Date.now() / 1000),
        expiry_notification_sent: SubscriptionStatus.INACTIVE,
        status: SubscriptionStatus.INACTIVE,
        email_confirmed: hasEmail ? false : undefined,
        sms_confirmed: hasSms ? false : undefined,
        // SMS secret must be separate from hash so that hash
        // cannot be used to confirm SMS subscriptions and vice versa.
        sms_secret: randomBytes(32).toString('hex'),
        delete_after: deleteAfter,
      };

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
            const document: QueueInsertDocument = {
              type: 'email',
              atv_id: atvId,
              content: await confirmationEmail(
                request.body.lang,
                {
                  link: `${subscribeLinkBase}/hakuvahti/confirm?subscription=${response.insertedId}&hash=${hash}`,
                  search_description: request.body.search_description,
                },
                siteConfig,
              ),
            };

            console.info('Sending email confirmation message to', response.insertedId);

            return mongodb.db?.collection('queue')?.insertOne(document);
          })(),

        // Queue sms confirmation:
        hasSms &&
          (async () => {
            const document: QueueInsertDocument = {
              type: 'sms',
              atv_id: atvId,
              content: await confirmationSms(
                request.body.lang,
                {
                  id: response.insertedId.toString(),
                },
                siteConfig,
              ),
            };

            console.info('Sending sms confirmation message to', response.insertedId);

            return mongodb.db?.collection('queue')?.insertOne(document);
          })(),
      ]);

      return reply.code(200).header('Content-Type', 'application/json; charset=utf-8').send(response);
    },
  );
};

export default subscription;
