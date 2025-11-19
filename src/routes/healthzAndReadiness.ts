import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

const healthzAndReadiness: FastifyPluginAsync = async (fastify, _opts) => {
  fastify.get(
    '/healthz',
    {
      logLevel: 'silent',
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              statusCode: { type: 'number' },
              message: { type: 'string' },
            },
            required: ['statusCode', 'message'],
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) =>
      reply.code(200).send({
        statusCode: 200,
        message: 'OK',
      }),
  );

  fastify.get(
    '/readiness',
    {
      logLevel: 'silent',
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              statusCode: { type: 'number' },
              message: { type: 'string' },
            },
            required: ['statusCode', 'message'],
          },
          500: {
            type: 'object',
            properties: {
              statusCode: { type: 'number' },
              message: { type: 'string' },
            },
            required: ['statusCode', 'message'],
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const mongodb = fastify.mongo;

      try {
        // Check MongoDB connection
        await mongodb.db?.command({ ping: 1 });

        return reply.code(200).send({
          statusCode: 200,
          message: 'OK',
        });
      } catch {
        return reply.code(500).send({
          statusCode: 500,
          message: 'MongoDB connection failed',
        });
      }
    },
  );
};

export default healthzAndReadiness;
