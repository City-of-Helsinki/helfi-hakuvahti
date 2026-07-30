import { type Static, Type } from '@sinclair/typebox';

const BroadcastMessage = Type.Object({
  subject: Type.String({ minLength: 1, maxLength: 255 }),
  /** Plain text. Escaped and converted to HTML before rendering. */
  body: Type.String({ minLength: 1, maxLength: 10000 }),
  /** Plain text, sent verbatim as the SMS content. */
  sms: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
});
export type BroadcastMessageType = Static<typeof BroadcastMessage>;

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

export const BroadcastAcceptedResponse = Type.Object({
  id: Type.String(),
});
export type BroadcastAcceptedResponseType = Static<typeof BroadcastAcceptedResponse>;

export const BroadcastStats = Type.Object({
  subscriptionsChecked: Type.Number(),
  emailsQueued: Type.Number(),
  smsQueued: Type.Number(),
  /** Subscriptions whose ATV document or contact details were missing. */
  missingContacts: Type.Number(),
});
export type BroadcastStatsType = Static<typeof BroadcastStats>;

export const BroadcastStatusResponse = Type.Object({
  id: Type.String(),
  site_id: Type.String(),
  status: Type.Union([Type.Literal('processing'), Type.Literal('completed'), Type.Literal('failed')]),
  test: Type.Boolean(),
  created: Type.String(),
  stats: Type.Union([BroadcastStats, Type.Null()]),
});
export type BroadcastStatusResponseType = Static<typeof BroadcastStatusResponse>;

/** Broadcast status record. */
export interface BroadcastStatusDocument {
  type: 'broadcast';
  site_id: string;
  status: 'processing' | 'completed' | 'failed';
  test: boolean;
  created: Date;
  stats: BroadcastStatsType | null;
}
