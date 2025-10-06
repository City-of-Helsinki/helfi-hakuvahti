import type { FastifyPluginAsync } from 'fastify';

const root: FastifyPluginAsync = async (fastify, _opts): Promise<void> => {
  fastify.get('/', async function rootHandler(_request, _reply) {
    return { root: true };
  });
};

export default root;
