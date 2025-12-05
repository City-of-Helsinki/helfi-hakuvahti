import { ObjectId } from '@fastify/mongodb';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader';
import { Generic500Error, type Generic500ErrorType } from '../types/error';

import {
  SubscriptionRenewResponse,
  type SubscriptionRenewResponseType,
  SubscriptionStatus,
} from '../types/subscription';

// Renews subscription by resetting the created timestamp

const renewSubscription: FastifyPluginAsync = async (fastify: FastifyInstance, _opts: object): Promise<void> => {
  fastify.get<{
    Reply: SubscriptionRenewResponseType | Generic500ErrorType;
  }>(
    '/subscription/renew/:id/:hash',
    {
      schema: {
        response: {
          200: SubscriptionRenewResponse,
          500: Generic500Error,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const mongodb = fastify.mongo;
      const collection = mongodb.db?.collection('subscription');
      const { id, hash } = request.params as { id: string; hash: string };

      // Find subscription with matching id and hash
      const subscription = await collection?.findOne({
        _id: new ObjectId(id),
        hash,
      });

      if (!subscription) {
        return reply.code(404).send({
          statusCode: 404,
          statusMessage: 'Subscription not found.',
        });
      }

      // Only allow renewal for ACTIVE subscriptions
      if (subscription.status !== SubscriptionStatus.ACTIVE) {
        return reply.code(400).send({
          statusCode: 400,
          statusMessage: 'Only active subscriptions can be renewed.',
        });
      }

      // Load site configuration to get maxAge and expiryNotificationDays
      const configLoader = SiteConfigurationLoader.getInstance();
      await configLoader.loadConfigurations();
      const siteConfig = configLoader.getConfiguration(subscription.site_id);

      if (!siteConfig) {
        return reply.code(500).send({
          statusCode: 500,
          statusMessage: 'Site configuration not found.',
        });
      }

      // Calculate when the expiry notification would be sent
      const daysBeforeExpiry = siteConfig.subscription.expiryNotificationDays;
      const subscriptionValidForDays = siteConfig.subscription.maxAge;
      const subscriptionExpiresAt =
        new Date(subscription.created).getTime() + subscriptionValidForDays * 24 * 60 * 60 * 1000;
      const subscriptionExpiryNotificationDate = new Date(
        subscriptionExpiresAt - daysBeforeExpiry * 24 * 60 * 60 * 1000,
      );

      // Only allow renewal if current time is past the expiry notification date
      if (Date.now() < subscriptionExpiryNotificationDate.getTime()) {
        return reply.code(400).send({
          statusCode: 400,
          statusMessage: 'Subscription cannot be renewed yet.',
        });
      }

      // Archive the original created date if not already archived
      const updateFields: Record<string, unknown> = {
        created: new Date(),
        modified: new Date(),
        expiry_notification_sent: SubscriptionStatus.INACTIVE,
      };

      // Only set first_created if it doesn't exist yet (for multiple renewals)
      if (!subscription.first_created) {
        updateFields.first_created = subscription.created;
      }

      // Update ATV document's delete_after timestamp to match the new subscription expiry
      try {
        await fastify.atvUpdateDocumentDeleteAfter(subscription.email, subscriptionValidForDays, new Date());
      } catch (error) {
        fastify.log.error({
          level: 'error',
          message: 'Failed to update ATV document delete_after timestamp',
          error,
          subscriptionId: id,
          atvDocumentId: subscription.email,
        });
        return reply.code(500).send({
          statusCode: 500,
          statusMessage: 'Failed to update subscription expiry in storage.',
        });
      }

      // Update subscription with new created timestamp
      await collection?.updateOne({ _id: new ObjectId(id) }, { $set: updateFields });

      // Calculate new expiry date
      const newExpiryDate = new Date(Date.now() + subscriptionValidForDays * 24 * 60 * 60 * 1000);

      return reply.code(200).header('Content-Type', 'application/json; charset=utf-8').send({
        statusCode: 200,
        statusMessage: 'Subscription renewed successfully.',
        expiryDate: newExpiryDate.toISOString(),
      });
    },
  );
};

export default renewSubscription;
