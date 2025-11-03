import { type Static, Type } from '@sinclair/typebox';

export const SmsQueueDocument = Type.Object({
  _id: Type.Optional(Type.String()),
  sms: Type.String(),
  content: Type.String(),
});

export type SmsQueueDocumentType = Static<typeof SmsQueueDocument>;

export const SmsQueueInsertDocument = Type.Object({
  sms: Type.String(),
  content: Type.String(),
});

export type SmsQueueInsertDocumentType = Static<typeof SmsQueueInsertDocument>;
