import { type Static, Type } from '@sinclair/typebox';

const BroadcastMessage = Type.Object({
  subject: Type.String({ minLength: 1, maxLength: 255 }),
  /** Plain text. Escaped and converted to HTML before rendering. */
  body: Type.String({ minLength: 1, maxLength: 10000 }),
  /** Plain text, sent verbatim as the SMS content. */
  sms: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
});
export type BroadcastMessageType = Static<typeof BroadcastMessage>;

/**
 * The access token of the admin sending the broadcast.
 *
 * This cannot go in the Authorization header (since it carries the api key).
 */
export const BroadcastHeaders = Type.Object({
  'x-access-token': Type.String({ minLength: 1 }),
});
export type BroadcastHeadersType = Static<typeof BroadcastHeaders>;

export const BroadcastRequest = Type.Object({
  site_id: Type.String(),
  messages: Type.Object({
    fi: BroadcastMessage,
    sv: BroadcastMessage,
    en: BroadcastMessage,
  }),
  /** Test mode: when present, send only to these subscriptions of the site. */
  subscription_ids: Type.Optional(Type.Array(Type.String(), { minItems: 1, maxItems: 10 })),
});
export type BroadcastRequestType = Static<typeof BroadcastRequest>;

/** What a finished broadcast queued, logged once the fan-out resolves. */
export interface BroadcastStatsType {
  subscriptionsChecked: number;
  emailsQueued: number;
  smsQueued: number;
  /** Subscriptions whose ATV document or contact details were missing. */
  missingContacts: number;
}
