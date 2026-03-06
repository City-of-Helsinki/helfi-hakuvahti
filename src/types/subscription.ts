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

export const SubscriptionCollectionLanguage = Type.Union([Type.Literal('en'), Type.Literal('fi'), Type.Literal('sv')]);
export type SubscriptionCollectionLanguageType = Static<typeof SubscriptionCollectionLanguage>;

export const SubscriptionCollection = Type.Object({
  /** Link to the ATV document where user data is stored. */
  atv_id: Type.Optional(Type.String()),
  /** Truthy if query information is is stored in ATV. */
  user_data_in_atv: Type.Optional(Type.Number()),

  elastic_query: Type.String(),
  search_description: Type.Optional(Type.String()),
  query: Type.String(),
  /** Legacy, always empty string. */
  // @todo figure out how to remove this from schema so
  //   we don't need to store empty string to this field.
  email: Type.String(),

  /** An extra layer of protection for the email subscriptions.
   * The User must know both database is and hash to operate on
   * email subscription. This enables us to use database ids that
   * are guessable */
  hash: Type.Optional(Type.String()),
  /** Subscription configuration id. See /conf directory. */
  site_id: Type.String(),

  /** Time when the subscription was last renewed. */
  created: Type.Date(),
  /** Time when the subscription was last modified. */
  modified: Type.Date(),
  /** When the subscription expires. */
  delete_after: Type.Optional(Type.Date()),
  /** Created is updated each time the subscription is renewed. */
  first_created: Type.Optional(Type.Date()),

  lang: SubscriptionCollectionLanguage,
  /** Notifications are sent if results are newer than last_checked. */
  last_checked: Type.Optional(Type.Number()),
  /** Flag indicating that the user was notified about an expiring subscription. */
  expiry_notification_sent: Type.Enum(SubscriptionStatus),
  status: Type.Enum(SubscriptionStatus),

  /** Indicates if the email subscription is confirmed. */
  email_confirmed: Type.Optional(Type.Boolean()),
  /** Indicates if the sms subscription is confirmed. */
  sms_confirmed: Type.Optional(Type.Boolean()),

  /** Similar to hash but for sms subscriptions. */
  sms_secret: Type.String(),
});
export type SubscriptionCollectionType = Static<typeof SubscriptionCollection>;

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
  user_data_in_atv: Type.Optional(Type.Number()),
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
});
export type SmsVerificationRequestType = Static<typeof SmsVerificationRequest>;

// SMS verification response
export const SmsVerificationResponse = Type.Object({
  statusCode: Type.Number(),
  statusMessage: Type.String(),
});
export type SmsVerificationResponseType = Static<typeof SmsVerificationResponse>;
