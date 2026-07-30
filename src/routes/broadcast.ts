import { ObjectId } from '@fastify/mongodb';
import * as Sentry from '@sentry/node';
import type { FastifyPluginAsync } from 'fastify';
import {
  blockBroadcasts,
  isBroadcastBlocked,
  registerFailedAttempt,
  resetFailedAttempts,
  verifyBroadcastCode,
} from '../lib/broadcastAuth.ts';
import { BroadcastService } from '../lib/broadcastService.ts';
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader.ts';
import {
  BroadcastAcceptedResponse,
  type BroadcastAcceptedResponseType,
  BroadcastRequest,
  type BroadcastRequestType,
  type BroadcastStatusDocument,
  BroadcastStatusResponse,
  type BroadcastStatusResponseType,
  PROCESSING_STALE_MS,
} from '../types/broadcast.ts';
import {
  Generic400Error,
  type Generic400ErrorType,
  Generic500Error,
  type Generic500ErrorType,
} from '../types/error.ts';
import type { SiteConfigurationType } from '../types/siteConfig.ts';
import { SUBSCRIPTION_LANGUAGES } from '../types/subscription.ts';

/** Broadcast status records are kept this long for the status endpoint. */
const STATUS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const broadcast: FastifyPluginAsync = async (fastify, _opts) => {
  fastify.post<{
    Body: BroadcastRequestType;
    Reply: BroadcastAcceptedResponseType | Generic400ErrorType | Generic500ErrorType;
  }>(
    '/broadcast',
    {
      schema: {
        body: BroadcastRequest,
        response: {
          202: BroadcastAcceptedResponse,
          400: Generic400Error,
          403: Generic400Error,
          409: Generic400Error,
          423: Generic400Error,
          500: Generic500Error,
        },
      },
    },
    async (request, reply) => {
      const db = fastify.mongo.db;
      if (!db) {
        throw new Error('MongoDB connection is not available.');
      }

      const lockedReply = () =>
        reply
          .code(423)
          .header('Content-Type', 'application/json')
          .send({ error: 'Broadcast API is locked. Try again later.' });

      if (await isBroadcastBlocked(db)) {
        return lockedReply();
      }

      // A missing or unreadable secret throws, which the Fastify error handler
      // turns into a 500 and reports to Sentry.
      if (!verifyBroadcastCode(request.body.totp_code)) {
        fastify.log.warn('Invalid broadcast verification code.');

        if (registerFailedAttempt()) {
          await blockBroadcasts(db, fastify.log);

          return lockedReply();
        }

        return reply
          .code(403)
          .header('Content-Type', 'application/json')
          .send({ error: 'Invalid verification code.', field: 'totp_code' });
      }

      resetFailedAttempts();

      let siteConfig: SiteConfigurationType;
      try {
        siteConfig = SiteConfigurationLoader.getConfiguration(request.body.site_id);
      } catch {
        return reply.code(400).header('Content-Type', 'application/json').send({ error: 'Invalid site_id provided.' });
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

      const statusCollection = db.collection<BroadcastStatusDocument>('queue');

      // Guard full broadcasts against double submission. Test sends neither
      // set nor respect the guard.
      if (!isTest) {
        const processing = await statusCollection.findOne({
          type: 'broadcast',
          site_id: request.body.site_id,
          status: 'processing',
          test: { $ne: true },
          created: { $gt: new Date(Date.now() - PROCESSING_STALE_MS) },
        });

        if (processing) {
          return reply
            .code(409)
            .header('Content-Type', 'application/json')
            .send({ error: 'A broadcast for this site is already being processed.' });
        }
      }

      await statusCollection.deleteMany({
        type: 'broadcast',
        created: { $lt: new Date(Date.now() - STATUS_RETENTION_MS) },
      });

      const record = await statusCollection.insertOne({
        type: 'broadcast',
        site_id: request.body.site_id,
        status: 'processing',
        test: isTest,
        created: new Date(),
        stats: null,
      });

      // Fan-out can take minutes for large sites (contact details are
      // resolved from ATV in batches), so it runs after the reply.
      new BroadcastService({ db, atv: fastify.atv })
        .broadcast(siteConfig, request.body.messages, subscriptionIds)
        .then((stats) =>
          statusCollection.updateOne({ _id: record.insertedId }, { $set: { status: 'completed', stats } }),
        )
        .catch(async (error) => {
          Sentry.captureException(error);
          fastify.log.error(error);
          await statusCollection
            .updateOne({ _id: record.insertedId }, { $set: { status: 'failed' } })
            .catch((updateError) => fastify.log.error(updateError));
        });

      return reply.code(202).header('Content-Type', 'application/json').send({ id: record.insertedId.toString() });
    },
  );

  fastify.get<{
    Params: { id: string };
    Reply: BroadcastStatusResponseType | Generic400ErrorType | Generic500ErrorType;
  }>(
    '/broadcast/:id',
    {
      schema: {
        response: {
          200: BroadcastStatusResponse,
          400: Generic400Error,
          404: Generic400Error,
          500: Generic500Error,
        },
      },
    },
    async (request, reply) => {
      if (!ObjectId.isValid(request.params.id)) {
        return reply.code(400).header('Content-Type', 'application/json').send({ error: 'Invalid broadcast id' });
      }

      const record = await fastify.mongo.db
        ?.collection<BroadcastStatusDocument>('queue')
        .findOne({ _id: new ObjectId(request.params.id), type: 'broadcast' });

      if (!record) {
        return reply.code(404).header('Content-Type', 'application/json').send({ error: 'Broadcast not found.' });
      }

      return reply.code(200).header('Content-Type', 'application/json').send({
        id: record._id.toString(),
        site_id: record.site_id,
        status: record.status,
        test: record.test,
        created: record.created.toISOString(),
        stats: record.stats,
      });
    },
  );
};

export default broadcast;
