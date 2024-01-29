import fp from 'fastify-plugin'

// Validate token in request headers

export default fp(async (fastify, opts) => {
  fastify.addHook('preHandler', async (request, reply) => {
    if (!request.headers.token) {
      reply
        .code(403)
        .header('Content-Type', 'application/json; charset=utf-8')
        .send({ error: 'Authentication failed.'})
    }

    // TODO: Token auth / check.

    return true;
  })
})

declare module 'fastify' {
  export interface FastifyRequest {
    tokenAuthentication?: boolean
  }
}
