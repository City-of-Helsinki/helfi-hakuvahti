// eslint-disable-next-line import/no-extraneous-dependencies
import * as Sentry from '@sentry/node';

declare module 'fastify' {
    export interface FastifyInstance {
        Sentry: typeof Sentry;
    }
}
