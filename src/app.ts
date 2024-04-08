import { join } from 'path';
import AutoLoad, { AutoloadPluginOptions } from '@fastify/autoload';
import { FastifyPluginAsync, FastifyServerOptions } from 'fastify';
import { Environment } from './types/environment';

export interface AppOptions extends FastifyServerOptions, Partial<AutoloadPluginOptions> {

}
// Pass --options via CLI arguments in command to enable these options.
const options: AppOptions = {
}

const app: FastifyPluginAsync<AppOptions> = async (
    fastify,
    opts
): Promise<void> => {
  const release = new Date()

  if (process.env.ENVIRONMENT === undefined) {
    throw new Error('ENVIRONMENT environment variable is not set')
  }

  const env = process.env.ENVIRONMENT as Environment

  if (!Object.values(Environment).includes(env)) {
    throw new Error('ENVIRONMENT environment variable is not valid')
  }

  fastify.register(require('@immobiliarelabs/fastify-sentry'), {
    dsn: process.env.SENTRY_DSN,
    environment: env,
    release: release.toISOString().substring(0, 10),
    setErrorHandler: true
  })

  await Promise.all([
    fastify.register(AutoLoad, {
      dir: join(__dirname, 'plugins'),
      options: opts,
      ignorePattern: /(^|\/|\\)(index|.d).*\.ts$/
    }),
    fastify.register(AutoLoad, {
      dir: join(__dirname, 'routes'),
      options: opts,
      ignorePattern: /(^|\/|\\)(index|.d).*\.ts$/
    })
  ])
}

export default app;
export { app, options }
