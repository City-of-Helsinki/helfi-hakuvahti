import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AutoLoad, { type AutoloadPluginOptions } from '@fastify/autoload';
import fastifySentry from '@immobiliarelabs/fastify-sentry';
import type { FastifyPluginAsync, FastifyPluginOptions } from 'fastify';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface AppOptions extends FastifyPluginOptions, Partial<AutoloadPluginOptions> {}

// Pass --options via CLI arguments in command to enable these options.
export const options: AppOptions = {};

const app: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
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
    environment: process.env.ENVIRONMENT,
    release: process.env.SENTRY_RELEASE ?? '',
    setErrorHandler: true,
  });

  fastify.register(AutoLoad, {
    dir: join(__dirname, 'plugins'),
    options: opts,
    ignorePattern: /(^|\/|\\)(index|\.d).*\.ts$/,
  });
  fastify.register(AutoLoad, {
    dir: join(__dirname, 'routes'),
    options: opts,
    ignorePattern: /(^|\/|\\)(index|\.d).*\.ts$/,
  });
};

export default app;
