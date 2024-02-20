import axios, { AxiosResponse } from 'axios';
import fp from 'fastify-plugin'

// Query Elastic Proxy

export interface ElasticProxyPluginOptions {
}

/**
 * Function to query ElasticSearch proxy with the given ElasticSearch query JSON.
 *
 * @param {string} elasticQueryJson - the JSON string representing the ElasticSearch query
 * @return {Promise<unknown>} the response data from the ElasticSearch proxy
 * @todo create type the return value from elastic
 */
const queryElasticProxy = async (elasticQueryJson: string): Promise<unknown> => {
  try {
    if (!process.env.ELASTIC_PROXY_URL) {
      throw new Error('ELASTIC_PROXY_URL is not set');
    }

    const elasticProxyUrl: string = process.env.ELASTIC_PROXY_URL + '/_msearch';
    const headers: { [key: string]: string } = {
      'Content-Type': 'application/x-ndjson'
    };

    const response: AxiosResponse<unknown> = await axios.post<unknown>(
      elasticProxyUrl,
      elasticQueryJson,
      {
        headers: headers
      }
    );
    return response.data;
  } catch (error) {
    throw new Error('Error while sending request to ElasticSearch proxy');
  }
}

export default fp<ElasticProxyPluginOptions>(async (fastify, opts) => {
  fastify.decorate('queryElasticProxy', queryElasticProxy)
})

declare module 'fastify' {
  export interface FastifyInstance {
    queryElasticProxy(elasticQueryJson: string): unknown;
  }
}
