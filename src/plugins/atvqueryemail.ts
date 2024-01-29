import fp from 'fastify-plugin'

// Get plaintext email by hash from ATV

export interface AtvQueryEmailPluginOptions {
}

export default fp<AtvQueryEmailPluginOptions>(async (fastify, opts) => {
  fastify.decorate('atvQueryEmail', async function (emailHash: string) {
    // TODO: query email from ATV

    return emailHash
  })
})

declare module 'fastify' {
  export interface FastifyInstance {
    AtvQueryEmail(email: string): unknown;
  }
}
