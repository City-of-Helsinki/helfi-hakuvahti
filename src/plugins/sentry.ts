import type * as Sentry from '@sentry/node';

declare module 'fastify' {
  export interface FastifyInstance {
    Sentry: typeof Sentry;
  }
}
