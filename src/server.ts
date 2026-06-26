import Fastify from 'fastify';
import app, { options } from './app.ts';
import { Environment } from './types/environment.ts';

const requiredEnvironmentVariables = ['ENVIRONMENT', 'HAKUVAHTI_API_KEY'];
for (const envVar of requiredEnvironmentVariables) {
  if (process.env[envVar] === undefined) {
    throw new Error(`${envVar} environment variable is not set`);
  }
}

const env = process.env.ENVIRONMENT as Environment;

if (!Object.values(Environment).includes(env)) {
  throw new Error('ENVIRONMENT environment variable is not valid');
}

const port = Number(process.env.FASTIFY_PORT ?? 3000);
const host = process.env.FASTIFY_ADDRESS ?? '0.0.0.0';
const level = process.env.FASTIFY_LOG_LEVEL ?? 'info';

const server = Fastify({ logger: { level } });

server.register(app, options);

const closeGracefully = async (signal: string): Promise<void> => {
  server.log.info(`Received ${signal}, closing server`);
  await server.close();
  process.exit(0);
};

process.once('SIGINT', () => void closeGracefully('SIGINT'));
process.once('SIGTERM', () => void closeGracefully('SIGTERM'));

try {
  await server.listen({ port, host });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
