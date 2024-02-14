import fp from 'fastify-plugin'

// Helper plugin for random hash

export interface RandHashPluginOptions {
}

export default fp<RandHashPluginOptions>(async (fastify, opts) => {
  fastify.decorate('getRandHash', function () {
    return (Math.random() + 1).toString(36).substring(2);
  })
})

declare module 'fastify' {
  export interface FastifyInstance {
    getRandHash(): string;
  }
}
