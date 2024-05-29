import {
  FastifyPluginAsync,
  FastifyReply,
  FastifyInstance,
  FastifyRequest
} from 'fastify';

const healthzAndReadiness: FastifyPluginAsync = async (
  fastify: FastifyInstance,
  opts: object
): Promise<void> => {

  // /healthz route
  fastify.get('/healthz', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            message: { type: 'string' }
          },
          required: ['statusCode', 'message']
        }
      }
    }
  }, async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply
      .code(200)
      .send({
        statusCode: 200,
        message: 'OK'
      });
  });

  // /readiness route
  fastify.get('/readiness', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            message: { type: 'string' }
          },
          required: ['statusCode', 'message']
        },
        500: {
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            message: { type: 'string' }
          },
          required: ['statusCode', 'message']
        }
      }
    }
  }, async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const mongodb = fastify.mongo;

    try {
      // Check MongoDB connection
      await mongodb.db?.command({ ping: 1 });

      return reply
        .code(200)
        .send({
          statusCode: 200,
          message: 'OK'
        });
    } catch (error) {
      return reply
        .code(500)
        .send({
          statusCode: 500,
          message: 'MongoDB connection failed'
        });
    }
  });
};

export default healthzAndReadiness;
