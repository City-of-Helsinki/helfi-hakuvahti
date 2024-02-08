import axios, { AxiosResponse } from 'axios';
import fp from 'fastify-plugin'

// Query Elastic Proxy

export interface ElasticProxyPluginOptions {
}

export default fp<ElasticProxyPluginOptions>(async (fastify, opts) => {
  fastify.decorate('queryElasticProxy', async function (elasticQueryJson) {
    if (!process.env.ELASTIC_PROXY_URL) {
        throw new Error('ELASTIC_PROXY_URL is not set')
    }

    const elasticProxyUrl: string = process.env.ELASTIC_PROXY_URL + '/_msearch'
    const headers = {
      'Content-Type': 'application/x-ndjson'
    }

    const response: AxiosResponse = await axios.post(
      elasticProxyUrl,
      elasticQueryJson,
      {
        headers: headers
      }
    );

    // TODO: type this:
    return response.data
  })
})

declare module 'fastify' {
  export interface FastifyInstance {
    queryElasticProxy(elasticQueryJson: string): unknown;
  }
}
