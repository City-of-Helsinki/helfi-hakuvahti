import fp from 'fastify-plugin'

// Validate token in request headers

export default fp(async (fastify, opts) => {
  fastify.addHook('preHandler', async (request, reply) => {
    // Skip token check for health check routes
    if (request.url === '/healthz' || request.url === '/readiness') {
      return true
    }

    if (!request.headers.token) {
      reply
        .code(403)
        .header('Content-Type', 'application/json; charset=utf-8')
        .send({ error: 'Authentication failed.'})
    }

    // TODO: Do something with the token

    return true
  })
})

declare module 'fastify' {
  export interface FastifyRequest {
    tokenAuthentication?: boolean
  }
}
