import { FastifyPluginAsync } from "fastify"
import { 
  SubscriptionResponse,
  SubscriptionResponseType,
  SubscriptionCollectionType,
  SubscriptionRequest, 
  SubscriptionRequestType, 
  SubscriptionStatus,
} from "../types/subscription";

const subscription: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
  fastify.post<{
    Body: SubscriptionRequestType,
    Reply: SubscriptionResponseType
  }>('/subscription', {
    schema: {
      body: SubscriptionRequest,
      response: {
        200: SubscriptionResponse
      }
    }
  }, async (request, reply) => {
    const mongodb = fastify.mongo
    
    const collection = mongodb.db?.collection('subscription')
    const subscription:Partial<SubscriptionCollectionType> = {
      ...request.body,
      created: new Date(),
      modified: new Date(),
      status: SubscriptionStatus.INACTIVE
    };
    const response = await collection?.insertOne(subscription);
    return {
      acknowledged: response.acknowledged,
      insertedId: response.insertedId
    }
  });
};

export default subscription;
