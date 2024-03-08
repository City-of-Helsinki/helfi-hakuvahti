import axios from 'axios';
import fp from 'fastify-plugin'
import { ElasticProxyResponseType } from '../types/elasticproxy';

// Query Elastic Proxy

export interface ElasticProxyPluginOptions {
}

/**
 * Sends a query to the ElasticSearch proxy.
 * @param elasticQueryJson - The JSON string representing the ElasticSearch query.
 * @returns The response data from the ElasticSearch proxy.
 */
const queryElasticProxy = async (elasticQueryJson: string): Promise<ElasticProxyResponseType> => {
  if (!process.env.ELASTIC_PROXY_URL) {
    throw new Error('ELASTIC_PROXY_URL is not set')
  }

  const elasticProxyUrl: string = process.env.ELASTIC_PROXY_URL + (elasticQueryJson.startsWith("{}\n") ? '/_msearch' : '/_search');
  const contentType: string = elasticQueryJson.startsWith("{}\n") ? 'application/x-ndjson' : 'application/json';

  try {
    const response = await axios.post<ElasticProxyResponseType>(
      elasticProxyUrl,
      // ElasticProxy requests must terminate to newline or server returns Bad request
      elasticQueryJson + (elasticQueryJson.endsWith("\n") ? '' : '\n'),
      {
        headers: {
          'Content-Type': contentType
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error(error)
    throw new Error('Error while sending request to ElasticSearch proxy');
  }
}

export default fp<ElasticProxyPluginOptions>(async (fastify, opts) => {
  fastify.decorate('queryElasticProxy', queryElasticProxy)
})

declare module 'fastify' {
  export interface FastifyInstance {
    queryElasticProxy(elasticQueryJson: string): Promise<ElasticProxyResponseType>
  }
}
