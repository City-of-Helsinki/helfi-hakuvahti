import { type Static, Type } from '@sinclair/typebox';

export enum SubscriptionStatus {
  DISABLED = 2,
  ACTIVE = 1,
  INACTIVE = 0,
}
export const SubscriptionStatusType = Type.Enum(SubscriptionStatus);

export const SubscriptionStatusResponse = Type.Object({
  subscriptionStatus: Type.Union([Type.Literal('active'), Type.Literal('inactive'), Type.Literal('disabled')]),
});
export type SubscriptionStatusResponseType = Static<typeof SubscriptionStatusResponse>;

export const SubscriptionRenewResponse = Type.Object({
  statusCode: Type.Number(),
  statusMessage: Type.String(),
  expiryDate: Type.String(), // ISO date string
});
export type SubscriptionRenewResponseType = Static<typeof SubscriptionRenewResponse>;

export const SubscriptionCollectionLanguage = Type.Union([Type.Literal('en'), Type.Literal('fi'), Type.Literal('sv')]);
export type SubscriptionCollectionLanguageType = Static<typeof SubscriptionCollectionLanguage>;

export const SubscriptionCollection = Type.Object({
  email: Type.String(),
  elastic_query: Type.String(),
  elastic_query_atv: Type.Optional(Type.Number()),
  search_description: Type.Optional(Type.String()),
  hash: Type.Optional(Type.String()),
  query: Type.String(),
  site_id: Type.String(),
  created: Type.Date(),
  modified: Type.Date(),
  lang: SubscriptionCollectionLanguage,
  last_checked: Type.Optional(Type.Number()),
  expiry_notification_sent: Type.Enum(SubscriptionStatus),
  status: Type.Enum(SubscriptionStatus),
  email_confirmed: Type.Optional(Type.Boolean()),
  sms_confirmed: Type.Optional(Type.Boolean()),
  delete_after: Type.Optional(Type.Date()),
  first_created: Type.Optional(Type.Date()),
  sms_code: Type.Optional(Type.String()),
  sms_code_created: Type.Optional(Type.Date()),
});
export type SubscriptionCollectionType = Static<typeof SubscriptionCollection>;

// Subscription renewal
export const RenewalSubscription = Type.Intersect([
  Type.Pick(SubscriptionCollection, ['email', 'site_id', 'status', 'created', 'first_created']),
  Type.Object({ _id: Type.Unknown() }),
]);
export type RenewalSubscriptionType = Static<typeof RenewalSubscription>;

// MongoDB response when inserting:
export const SubscriptionResponse = Type.Object({
  acknowledged: Type.Boolean(),

  // This is actually MongoDB's ObjectId object:
  insertedId: Type.Optional(Type.Unknown()),
});
export type SubscriptionResponseType = Static<typeof SubscriptionResponse>;

// Request to add new subscription (either email or sms is required, both allowed):
const SubscriptionRequestBase = Type.Object({
  elastic_query: Type.String(),
  elastic_query_atv: Type.Optional(Type.Number()),
  query: Type.String(),
  search_description: Type.Optional(Type.String()),
  site_id: Type.String(),
  lang: SubscriptionCollectionLanguage,
});

export const SubscriptionRequest = Type.Union([
  Type.Intersect([
    SubscriptionRequestBase,
    Type.Object({
      email: Type.String(),
      sms: Type.Optional(Type.String()),
    }),
  ]),
  Type.Intersect([
    SubscriptionRequestBase,
    Type.Object({
      email: Type.Optional(Type.String()),
      sms: Type.String(),
    }),
  ]),
]);
export type SubscriptionRequestType = Static<typeof SubscriptionRequest>;

// Generic request with SubscriptionId
export const SubscriptionGenericPostRequest = Type.Object({
  id: Type.String(),
});
export type SubscriptionGenericPostRequestType = Static<typeof SubscriptionGenericPostRequest>;

// Generic response with id and status code
export const SubscriptionGenericPostResponse = Type.Object({
  id: Type.Optional(Type.String()),
  statusCode: Type.Number(),
  statusMessage: Type.Optional(Type.String()),
});
export type SubscriptionGenericPostResponseType = Static<typeof SubscriptionGenericPostResponse>;

// SMS verification request
export const SmsVerificationRequest = Type.Object({
  sms_code: Type.String(),
  number: Type.String(),
});
export type SmsVerificationRequestType = Static<typeof SmsVerificationRequest>;

// SMS verification response
export const SmsVerificationResponse = Type.Object({
  statusCode: Type.Number(),
  statusMessage: Type.String(),
  expiryDate: Type.Optional(Type.String()),
});
export type SmsVerificationResponseType = Static<typeof SmsVerificationResponse>;

// Subscription document for SMS verification
export const VerificationSubscription = Type.Intersect([
  Type.Pick(SubscriptionCollection, [
    'email',
    'site_id',
    'status',
    'created',
    'first_created',
    'sms_code',
    'sms_code_created',
  ]),
  Type.Object({ _id: Type.Unknown() }),
]);
export type VerificationSubscriptionType = Static<typeof VerificationSubscription>;
