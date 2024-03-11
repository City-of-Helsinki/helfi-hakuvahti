import fp from 'fastify-plugin'
import mongo from '@fastify/mongodb'
import { FastifyInstance } from 'fastify'

// MongoDB connection

export default fp(async function (fastify: FastifyInstance) {
  fastify.register(mongo, { 
    url: process.env.MONGODB, 
    forceClose: true 
  })
});
