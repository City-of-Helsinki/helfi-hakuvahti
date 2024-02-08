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
  SubscriptionStatus
} from "../types/subscription";

import { 
  Generic500Error, 
  Generic500ErrorType 
} from '../types/error';

// Add subscription to given query parameters

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
    const hash = fastify.getRandHash()

    // Replace email in request with ATV hashed email
    if (request?.atvResponse?.email) {
      request.body.email = request.atvResponse.email
    } else {
      // Bail out if we can't get hashed email from ATV

      return reply
        .code(500)
        .header('Content-Type', 'application/json; charset=utf-8')
        .send({ error: 'Could not find hashed email. Subscription not added.' });
    }

    const subscription: Partial<SubscriptionCollectionType> = {
      ...request.body,
      hash: hash,
      created: new Date(),
      modified: new Date(),
      status: SubscriptionStatus.INACTIVE
    };

    try {
      const response = await collection?.insertOne(subscription);
      
      if (response) {
        return reply
          .code(200)
          .header('Content-Type', 'application/json; charset=utf-8')
          .send(response);
      } else {
        return reply
          .code(500)
          .header('Content-Type', 'application/json; charset=utf-8')
          .send({ error: 'Could not add new subscription.' });
      }
    } catch (e: unknown) {
      return reply
        .code(500)
        .header('Content-Type', 'application/json; charset=utf-8')
        .send({ error: e });
    }
  });
};

export default subscription;
