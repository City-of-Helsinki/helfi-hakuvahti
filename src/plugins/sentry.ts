import Sentry from '@sentry/core'

declare module 'fastify' {
    export interface FastifyInstance {
        Sentry: typeof Sentry
    }
}
