import mongo from '@fastify/mongodb';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

// MongoDB connection

export default fp(async function mongodbPlugin(fastify: FastifyInstance) {
  fastify.register(mongo, {
    url: process.env.MONGODB,
    forceClose: true,
  });
});
