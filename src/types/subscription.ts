import { Static, Type } from '@sinclair/typebox'

// Subscription status:
export enum SubscriptionStatus {
    DISABLED = 2,
    ACTIVE = 1,
    INACTIVE = 0
}
export const SubscriptionStatusType = Type.Enum(SubscriptionStatus)  

// Subscription Collection schema:

export const SubscriptionCollectionLanguage = Type.Union([
    Type.Literal('en'),
    Type.Literal('fi'),
    Type.Literal('sv'),
])
export type SubscriptionCollectionLanguageType = Static<typeof SubscriptionCollectionLanguage>

export const SubscriptionCollection = Type.Object({
    email: Type.String(),
    elastic_query: Type.String(),
    hash: Type.Optional(Type.String()),
    query: Type.String(),
    created: Type.Date(),
    modified: Type.Date(),
    lang: SubscriptionCollectionLanguage,
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
    query: Type.String(),
    lang: SubscriptionCollectionLanguage
})
export type SubscriptionRequestType = Static<typeof SubscriptionRequest>

// Generic request with SubscriptionId
export const SubscriptionGenericPostRequest = Type.Object({
    id: Type.String()
})
export type SubscriptionGenericPostRequestType = Static<typeof SubscriptionGenericPostRequest>

// Generic response with id and status code
export const SubscriptionGenericPostResponse = Type.Object({
    id: Type.Optional(Type.String()),
    statusCode: Type.Number(),
    statusMessage: Type.Optional(Type.String())
})
export type SubscriptionGenericPostResponseType = Static<typeof SubscriptionGenericPostResponse>
