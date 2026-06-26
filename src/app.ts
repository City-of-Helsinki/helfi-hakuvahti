import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AutoLoad, { type AutoloadPluginOptions } from '@fastify/autoload';
import * as Sentry from '@sentry/node';
import type { FastifyPluginAsync, FastifyPluginOptions } from 'fastify';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface AppOptions extends FastifyPluginOptions, Partial<AutoloadPluginOptions> {}

// Pass --options via CLI arguments in command to enable these options.
export const options: AppOptions = {};

const app: FastifyPluginAsync<AppOptions> = async (fastify, opts) => {
  // Sentry is initialized via the preloaded src/instrument.ts; this wires up
  // the Fastify error handler so uncaught route errors are reported.
  Sentry.setupFastifyErrorHandler(fastify);

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
