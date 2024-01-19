import { 
  FastifyPluginAsync, 
  FastifyRequest, 
  FastifyReply, 
  FastifyInstance 
} from 'fastify';

import { 
  SubscriptionResponse,
  SubscriptionResponseType,
  SubscriptionCollectionType,
  SubscriptionRequest, 
  SubscriptionRequestType, 
  SubscriptionStatus,
} from "../types/subscription";

import { Generic500Error, Generic500ErrorType } from '../types/error';

const subscription: FastifyPluginAsync = async (
  fastify: FastifyInstance,
  opts: object
): Promise<void> => {
  fastify.post<{
    Body: SubscriptionRequestType,
    Reply: SubscriptionResponseType | Generic500ErrorType
  }>('/subscription', {
    schema: {
      body: SubscriptionRequest,
      response: {
        200: SubscriptionResponse,
        500: Generic500Error
      }
    }
  }, async (
    request: FastifyRequest<{ Body: SubscriptionRequestType }>,
    reply: FastifyReply
  ) => {
    const mongodb = fastify.mongo;
    const collection = mongodb.db?.collection('subscription');

    const isValid = validateSubscriptionRequest(request.body);

    if (!isValid) {
      reply.code(500).header('Content-Type', 'application/json; charset=utf-8').send({ error: 'Invalid subscription request.' });
      return;
    }

    const subscription: Partial<SubscriptionCollectionType> = {
      ...request.body,
      created: new Date(),
      modified: new Date(),
      status: SubscriptionStatus.INACTIVE
    };

    try {
      const response = await collection?.insertOne(subscription);
      
      if (response) {
        reply.code(200).header('Content-Type', 'application/json; charset=utf-8').send(response);
      } else {
        reply.code(500).header('Content-Type', 'application/json; charset=utf-8').send({ error: 'Could not add new subscription.' });
      }
    } catch (error) {
      reply.code(500).header('Content-Type', 'application/json; charset=utf-8').send({ error: error.message });
    }
  });
};


// Validate that the subscription request matches the partial SubscriptionCollectionType.
const validateSubscriptionRequest = (request: SubscriptionRequestType): boolean => {
  if (!request.elastic_query || !request.query || !request.email) {
    return false;
  }
  
  return true;
};

export default subscription;
