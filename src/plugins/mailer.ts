import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { FastifyMailer } from '../types/mailer';

// Initialize mailer as plugin

export default fp(async function mailerPlugin(fastify: FastifyInstance) {
  const opts = {
    defaults: {
      from: process.env.MAIL_FROM,
    },
    transport: {
      host: process.env.MAIL_HOST,
      port: process.env.MAIL_PORT,
      secure: process.env.MAIL_SECURE === 'true',
      auth: {
        user: process.env.MAIL_AUTH_USER,
        pass: process.env.MAIL_AUTH_PASS,
      },
    },
  };

  // eslint-disable-next-line global-require
  fastify.register(require('fastify-mailer'), opts);
});

declare module 'fastify' {
  // eslint-disable-next-line no-shadow
  interface FastifyInstance {
    mailer: FastifyMailer;
  }
}
