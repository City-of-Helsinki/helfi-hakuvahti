import fp from 'fastify-plugin'

// Gets email hash from ATV (request.body.email) and 
// adds hashed email to response.atvResponse.email

export interface AtvPluginOptions {
}

interface AtvResponse {
  email: string;
}
  
export default fp(async (fastify, opts) => {
  fastify.addHook('preHandler', async (request) => {

    // TODO: query atv with email in request.body.email

    request.atvResponse = {
      email: 'modified',
    };
  })
})

declare module 'fastify' {
  export interface FastifyRequest {
    atvResponse?: AtvResponse;
  }
}
