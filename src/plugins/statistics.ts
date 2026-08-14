import fp from 'fastify-plugin';
import { Statistics } from '../lib/statistics.ts';

// Aggregate subscription statistics. One instance, shared.

export default fp(
  async (fastify, _opts) => {
    if (!fastify.mongo.db) {
      throw new Error('MongoDB connection not available');
    }

    fastify.decorate('statistics', new Statistics({ db: fastify.mongo.db }));
  },
  // Declared rather than relying on autoload's alphabetical ordering, which would
  // break silently on a rename.
  { name: 'statistics', dependencies: ['mongodb'] },
);

declare module 'fastify' {
  export interface FastifyInstance {
    statistics: Statistics;
  }
}
