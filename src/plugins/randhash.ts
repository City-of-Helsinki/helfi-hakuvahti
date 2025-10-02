import fp from 'fastify-plugin';

// Helper plugin for random hash

export type RandHashPluginOptions = {};

export default fp<RandHashPluginOptions>(async (fastify, opts) => {
  fastify.decorate('getRandHash', function getRandHash() {
    return (Math.random() + 1).toString(36).substring(2);
  });
});

declare module 'fastify' {
  export interface FastifyInstance {
    getRandHash(): string;
  }
}
