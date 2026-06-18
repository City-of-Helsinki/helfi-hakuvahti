declare module 'fastify-mailer' {
  import type { FastifyPluginCallback } from 'fastify';

  // biome-ignore lint/suspicious/noExplicitAny: upstream package provides no types.
  const fastifyMailer: FastifyPluginCallback<any>;
  export default fastifyMailer;
}
