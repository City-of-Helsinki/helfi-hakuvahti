import { FastifyPluginAsync } from "fastify"
import { 
  SubscriptionCollectionType,
  SubscriptionRequest, 
  SubscriptionRequestType, 
  SubscriptionResponse, 
  SubscriptionResponseType,
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
    const r = await collection?.insertOne(subscription);
    console.log(r)
    return { email: request.body.email };
  });
};

export default subscription;
