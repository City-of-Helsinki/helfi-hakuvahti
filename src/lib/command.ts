import fastifySentry from '@immobiliarelabs/fastify-sentry';
import dotenv from 'dotenv';
import fastify, { type FastifyInstance } from 'fastify';
import minimist, { type ParsedArgs } from 'minimist';

dotenv.config();

export type Server = FastifyInstance;

export type Command = (server: Server, argv: ParsedArgs) => Promise<void>;

/**
 * Wrapper around fastify boilerplate for building console scripts.
 *
 * @param app - command handler
 * @param plugins - list of fastify plugins to register
 */
export default function command(app: Command, plugins: Array<(...args: any[]) => unknown> = []) {
  const server = fastify({});

  // Parse CLI arguments
  const argv = minimist(process.argv.slice(2));

  // Register sentry for all commands.
  server.register(fastifySentry, {
    dsn: process.env.SENTRY_DSN,
    environment: process.env.ENVIRONMENT,
    release: process.env.SENTRY_RELEASE ?? '',
    setErrorHandler: true,
  });

  plugins.forEach((plugin) => {
    server.register(plugin);
  });

  server.ready(async (err) => {
    if (err) {
      console.error('Server failed to start:', err);
      process.exit(1);
    }

    let result = true;

    try {
      await app(server, argv);
    } catch (err) {
      result = false;

      console.error('Command failed', err);
    }

    await server.close();

    // Exit with failure if command failed.
    process.exit(result ? 0 : 1);
  });

  return server;
}
