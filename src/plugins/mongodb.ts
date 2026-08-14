import mongo from '@fastify/mongodb';
import fp from 'fastify-plugin';

// MongoDB connection

export default fp(
  async function mongodbPlugin(fastify) {
    fastify.register(mongo, {
      url: process.env.MONGODB,
      forceClose: true,
    });
  },
  // Named so that plugins depending on fastify.mongo can say so.
  { name: 'mongodb' },
);
