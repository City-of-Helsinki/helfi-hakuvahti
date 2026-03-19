import fp from 'fastify-plugin';
import { ATV } from '../lib/atv';

export default fp(async (fastify, _opts) => {
  fastify.decorate(
    'atv',
    new ATV({
      apiUrl: process.env.ATV_API_URL ?? '',
      apiKey: process.env.ATV_API_KEY ?? '',
      defaultMaxAge: process.env.SUBSCRIPTION_MAX_AGE ? Number(process.env.SUBSCRIPTION_MAX_AGE) : undefined,
    }),
  );
});

declare module 'fastify' {
  export interface FastifyInstance {
    atv: ATV;
  }
}
