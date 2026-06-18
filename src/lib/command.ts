import * as Sentry from '@sentry/node';
import fastify, { type FastifyInstance } from 'fastify';
import parseArgs, { type ParsedArgs } from './parse-args.ts';

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
  const argv = parseArgs(process.argv.slice(2));

  // Sentry is initialized via the preloaded src/instrument.ts; this wires up
  // the Fastify error handler so uncaught command errors are reported.
  Sentry.setupFastifyErrorHandler(server);

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

    await server.Sentry?.flush(2000);
    await server.close();

    // Exit with failure if command failed.
    process.exit(result ? 0 : 1);
  });

  return server;
}
