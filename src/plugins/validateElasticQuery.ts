import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader';
import type { SubscriptionRequestType } from '../types/subscription';

export type ValidateElasticQueryPluginOptions = Record<string, never>;

/**
 * Pre-handler hook to validate Elastic queries before saving subscriptions.
 * This prevents broken queries from being saved in the database.
 *
 * @param request - the request object
 * @param fastify - fastify instance
 */
const validateElasticQueryHook = async (request: FastifyRequest, fastify: FastifyInstance) => {
  try {
    // Only run on POST requests to /subscription endpoint
    if (request.method !== 'POST' || request.url !== '/subscription') {
      return;
    }

    const body: Partial<SubscriptionRequestType> = request.body as Partial<SubscriptionRequestType>;
    const siteId = body.site_id;
    const elasticQuery = body.elastic_query;

    if (!siteId) {
      throw new Error('site_id is required');
    }

    if (!elasticQuery) {
      throw new Error('elastic_query is required');
    }

    const configLoader = SiteConfigurationLoader.getInstance();
    await configLoader.loadConfigurations();
    const siteConfig = configLoader.getConfiguration(siteId);

    if (!siteConfig) {
      throw new Error(`Invalid site_id: ${siteId}`);
    }

    // Decode elastic_query
    const decodedQuery = fastify.b64decode(elasticQuery);

    // Validate the query by executing it against Elastic
    await fastify.queryElasticProxy(siteConfig.elasticProxyUrl, decodedQuery);

    request.elasticQueryValidation = {
      isValid: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error validating Elastic query';
    fastify.log.error({ error: errorMessage }, 'Elastic query validation failed');

    request.elasticQueryValidation = {
      isValid: false,
      error: errorMessage,
    };
  }
};

export default fp<ValidateElasticQueryPluginOptions>(async (fastify, _opts) => {
  fastify.addHook('preHandler', async (request) => {
    await validateElasticQueryHook(request, fastify);
  });
});

declare module 'fastify' {
  export interface FastifyRequest {
    elasticQueryValidation?: {
      isValid: boolean;
      error?: string;
    };
  }
}
