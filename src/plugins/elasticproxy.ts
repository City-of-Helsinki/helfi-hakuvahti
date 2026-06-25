import fp from 'fastify-plugin';
import type { ElasticProxyJsonResponseType } from '../types/elasticproxy.ts';

// Query Elastic Proxy

export type ElasticProxyPluginOptions = Record<string, never>;

/**
 * Sends a query to the ElasticSearch proxy.
 * @param {string} elasticProxyBaseUrl - The base URL of the ElasticSearch proxy.
 * @param {string} elasticQueryJson - The JSON string representing the ElasticSearch query.
 * @return {Promise<ElasticProxyJsonResponseType>} The response data from the ElasticSearch proxy.
 */
const queryElasticProxy = async (
  elasticProxyBaseUrl: string,
  elasticQueryJson: string,
): Promise<ElasticProxyJsonResponseType> => {
  if (!elasticProxyBaseUrl) {
    throw new Error('elasticProxyBaseUrl is required');
  }

  // Elastic proxy supports ndjson (multipart json requests) or single json searches
  const elasticProxyUrl: string =
    elasticProxyBaseUrl + (elasticQueryJson.startsWith('{}\n') ? '/_msearch' : '/_search');
  const contentType: string = elasticQueryJson.startsWith('{}\n') ? 'application/x-ndjson' : 'application/json';

  try {
    const response = await fetch(elasticProxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
      },
      // ElasticProxy requests must terminate to newline or server returns Bad request
      body: elasticQueryJson + (elasticQueryJson.endsWith('\n') ? '' : '\n'),
    });

    if (!response.ok) {
      throw new Error(`ElasticSearch proxy responded ${response.status}`);
    }

    return (await response.json()) as ElasticProxyJsonResponseType;
  } catch (error) {
    console.error(error);

    throw new Error('Error while sending request to ElasticSearch proxy');
  }
};

export default fp<ElasticProxyPluginOptions>(async (fastify, _opts) => {
  fastify.decorate('queryElasticProxy', queryElasticProxy);
});

declare module 'fastify' {
  export interface FastifyInstance {
    queryElasticProxy(elasticProxyBaseUrl: string, elasticQueryJson: string): Promise<ElasticProxyJsonResponseType>;
  }
}
