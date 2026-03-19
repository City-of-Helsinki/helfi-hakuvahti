import sensible, { type FastifySensibleOptions } from '@fastify/sensible';
import fp from 'fastify-plugin';

// This plugin adds some utilities to handle http errors
export default fp<FastifySensibleOptions>(async (fastify) => {
  fastify.register(sensible);
});
