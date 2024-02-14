import axios, { AxiosResponse } from 'axios';
import fp from 'fastify-plugin'

// Query Elastic Proxy

export interface ElasticProxyPluginOptions {
}

const queryElasticProxy = async function (elasticQueryJson: string): Promise<unknown> {
  if (!process.env.ELASTIC_PROXY_URL) {
      throw new Error('ELASTIC_PROXY_URL is not set');
  }

  const elasticProxyUrl: string = process.env.ELASTIC_PROXY_URL + '/_msearch';
  const headers: { [key: string]: string } = {
    'Content-Type': 'application/x-ndjson'
  };

  try {
    const response: AxiosResponse<unknown> = await axios.post(
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
