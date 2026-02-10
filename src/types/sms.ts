import type * as Sentry from '@sentry/node';
import { type Static, Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { Db, ObjectId } from 'mongodb';
import type { DialogiClient } from '../plugins/dialogi';

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

/**
 * SMS queue item as retrieved from the database.
 */
export interface SmsQueueItemType {
  _id: ObjectId;
  sms: string; // ATV document ID
  content: string; // SMS message content
}

/**
 * Dependencies for the SMS queue service.
 */
export interface SmsQueueServiceDependenciesType {
  db: Db;
  atvClient: FastifyInstance;
  smsSender: DialogiClient;
  sentry?: typeof Sentry;
  batchSize?: number;
}
