import { ObjectId } from '@fastify/mongodb';
import * as Sentry from '@sentry/node';
import type { FastifyPluginAsync } from 'fastify';
import {
  authorizeBroadcastSender,
  BroadcastAuthError,
  type BroadcastSender,
  verifyBroadcastToken,
} from '../lib/broadcastAuth.ts';
import { BroadcastService } from '../lib/broadcastService.ts';
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader.ts';
import {
  BroadcastHeaders,
  type BroadcastHeadersType,
  BroadcastRequest,
  type BroadcastRequestType,
} from '../types/broadcast.ts';
import {
  Generic400Error,
  type Generic400ErrorType,
  Generic500Error,
  type Generic500ErrorType,
} from '../types/error.ts';
import type { SiteConfigurationType } from '../types/siteConfig.ts';
import { SUBSCRIPTION_LANGUAGES } from '../types/subscription.ts';

const broadcast: FastifyPluginAsync = async (fastify, _opts) => {
  fastify.post<{
    Body: BroadcastRequestType;
    Headers: BroadcastHeadersType;
    Reply: Generic400ErrorType | Generic500ErrorType | undefined;
  }>(
    '/broadcast',
    {
      schema: {
        body: BroadcastRequest,
        headers: BroadcastHeaders,
        response: {
          400: Generic400Error,
          403: Generic400Error,
          500: Generic500Error,
        },
      },
    },
    async (request, reply) => {
      const db = fastify.mongo.db;
      if (!db) {
        throw new Error('MongoDB connection is not available.');
      }

      let sender: BroadcastSender;
      try {
        sender = await verifyBroadcastToken(request.headers['x-access-token']);
      } catch (error) {
        // Anything that is not a rejected token is a problem on our end. Let it
        // through to the error handler, which turns it into a 500 and reports it
        // to Sentry, so broadcasting fails closed on a missing configuration.
        if (!(error instanceof BroadcastAuthError)) {
          throw error;
        }

        fastify.log.warn(`Rejected broadcast access token: ${error.message}`);

        return reply
          .code(403)
          .header('Content-Type', 'application/json')
          .send({ error: 'Invalid or expired access token.', field: 'access_token' });
      }

      let siteConfig: SiteConfigurationType;
      try {
        siteConfig = SiteConfigurationLoader.getConfiguration(request.body.site_id);
      } catch {
        return reply.code(400).header('Content-Type', 'application/json').send({ error: 'Invalid site_id provided.' });
      }

      let senderGroup: string;
      try {
        senderGroup = authorizeBroadcastSender(sender, siteConfig);
      } catch (error) {
        // As above: a site without configured groups is our problem, so it
        // becomes a 500 rather than a permission denial.
        if (!(error instanceof BroadcastAuthError)) {
          throw error;
        }

        fastify.log.warn(`Rejected broadcast for site ${request.body.site_id}: ${error.message}`);

        return reply
          .code(403)
          .header('Content-Type', 'application/json')
          .send({ error: 'Not authorized to broadcast for this site.', field: 'access_token' });
      }

      // Subscribers must not be excluded from an SMS broadcast based on
      // their language, so SMS texts are all-or-none.
      const smsCount = SUBSCRIPTION_LANGUAGES.filter((lang) => request.body.messages[lang].sms).length;
      if (smsCount !== 0 && smsCount !== SUBSCRIPTION_LANGUAGES.length) {
        return reply
          .code(400)
          .header('Content-Type', 'application/json')
          .send({ error: 'SMS text must be provided for either all languages or none.', field: 'sms' });
      }

      // Test mode: send only to the given subscriptions.
      let subscriptionIds: ObjectId[] | undefined;
      if (request.body.subscription_ids) {
        if (!request.body.subscription_ids.every((id) => ObjectId.isValid(id))) {
          return reply
            .code(400)
            .header('Content-Type', 'application/json')
            .send({ error: 'Invalid subscription id provided.', field: 'subscription_ids' });
        }
        subscriptionIds = request.body.subscription_ids.map((id) => new ObjectId(id));
      }
      const isTest = subscriptionIds !== undefined;

      const sentBy = `for site ${request.body.site_id} (test: ${isTest}) by sub ${sender.sub} via ${sender.azp} (group ${senderGroup})`;

      fastify.log.info(`Broadcast ${sentBy} accepted.`);

      // Fan-out can take minutes for large sites (contact details are
      // resolved from ATV in batches), so it runs after the reply. Nothing
      // reports back to the caller. The log and Sentry are the only outcome.
      new BroadcastService({ db, atv: fastify.atv })
        .broadcast(siteConfig, request.body.messages, subscriptionIds)
        .then((stats) => fastify.log.info(`Broadcast ${sentBy} queued ${JSON.stringify(stats)}.`))
        .catch((error) => {
          Sentry.captureException(error);
          fastify.log.error(error);
        });

      return reply.code(202).send(undefined);
    },
  );
};

export default broadcast;
