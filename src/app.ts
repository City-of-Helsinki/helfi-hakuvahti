import { join } from 'node:path';
import AutoLoad, { type AutoloadPluginOptions } from '@fastify/autoload';
import fastifySentry from '@immobiliarelabs/fastify-sentry';
import type { FastifyPluginAsync, FastifyPluginOptions } from 'fastify';
import { Environment } from './types/environment';

export interface AppOptions extends FastifyPluginOptions, Partial<AutoloadPluginOptions> {}

// Pass --options via CLI arguments in command to enable these options.
export const options: AppOptions = {};

const app: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  // Skip override option breaks fastify encapsulation.
  // This is used by tests to get access to plugins
  // registered by application.
  delete opts.skipOverride

  if (process.env.ENVIRONMENT === undefined) {
    throw new Error('ENVIRONMENT environment variable is not set');
  }

  const env = process.env.ENVIRONMENT as Environment;

  if (!Object.values(Environment).includes(env)) {
    throw new Error('ENVIRONMENT environment variable is not valid');
  }

  fastify.register(fastifySentry, {
    dsn: process.env.SENTRY_DSN,
    beforeSend: (event) => {
      if (!event?.request?.data) {
        return event;
      }

      const data = JSON.parse(event.request.data);

      if (!data.email) {
        return event;
      }

      delete data.email;
      event.request.data = JSON.stringify(data);

      return event;
    },
    environment: env,
    release: process.env.SENTRY_RELEASE ?? '',
    setErrorHandler: true,
  });

  fastify.register(AutoLoad, {
    dir: join(__dirname, 'plugins'),
    options: opts,
    ignorePattern: /(^|\/|\\)(index|.d).*\.ts$/,
  });
  fastify.register(AutoLoad, {
    dir: join(__dirname, 'routes'),
    options: opts,
    ignorePattern: /(^|\/|\\)(index|.d).*\.ts$/,
  });
};

export default app;
