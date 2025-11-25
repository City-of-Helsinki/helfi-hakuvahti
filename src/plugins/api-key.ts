import { timingSafeEqual } from 'node:crypto';
import fp from 'fastify-plugin';

/**
 * Validate token in request headers
 *
 * Requests must have 'Authorization: api-key <api-key>' header in the request.
 */
export default fp(async (fastify, _opts) => {
  fastify.addHook('preHandler', async (request, reply) => {
    // Skip token check for health check routes
    if (request.url === '/healthz' || request.url === '/readiness') {
      return true;
    }

    const { HAKUVAHTI_API_KEY } = process.env;
    const expected = Buffer.from(`api-key ${HAKUVAHTI_API_KEY}`);
    const received = Buffer.from(request.headers.authorization?.toString() ?? '');

    if (!HAKUVAHTI_API_KEY || expected.length !== received.length || !timingSafeEqual(expected, received)) {
      return reply.code(403).send();
    }

    return true;
  });
});
