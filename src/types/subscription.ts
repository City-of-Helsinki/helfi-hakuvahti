import { Static, Type } from '@sinclair/typebox'

// Subscription status:
export enum SubscriptionStatus {
    DISABLED = 2,
    ACTIVE = 1,
    INACTIVE = 0
}
export const SubscriptionStatusType = Type.Enum(SubscriptionStatus)  

// Subscription Collection schema:
export const SubscriptionCollection = Type.Object({
    email: Type.String(),
    elastic_query: Type.String(),
    query: Type.String(),
    created: Type.Date(),
    modified: Type.Date(),
    status: Type.Enum(SubscriptionStatus)
})
export type SubscriptionCollectionType = Static<typeof SubscriptionCollection>

// MongoDB response when inserting:
export const SubscriptionResponse = Type.Object({
    acknowledged: Type.Boolean(),

    // This is actually MongoDB's ObjectId object:
    insertedId: Type.Optional(Type.Unknown()), 
})
export type SubscriptionResponseType = Static<typeof SubscriptionResponse>

// Request to add new subscription:
export const SubscriptionRequest = Type.Object({
    email: Type.String(),
    elastic_query: Type.String(),
    query: Type.String()
})
export type SubscriptionRequestType = Static<typeof SubscriptionRequest>
