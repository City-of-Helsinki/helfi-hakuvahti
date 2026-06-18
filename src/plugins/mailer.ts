import fp from 'fastify-plugin';
import type { Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';

// Initialize mailer as plugin

export default fp(async function mailerPlugin(fastify) {
  const transporter = nodemailer.createTransport(
    {
      host: process.env.MAIL_HOST,
      port: Number(process.env.MAIL_PORT),
      secure: process.env.MAIL_SECURE === 'true',
      auth: {
        user: process.env.MAIL_AUTH_USER,
        pass: process.env.MAIL_AUTH_PASS,
      },
    },
    {
      from: process.env.MAIL_FROM,
    },
  );

  fastify.decorate('mailer', transporter);

  fastify.addHook('onClose', async () => {
    transporter.close();
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    mailer: Transporter;
  }
}
