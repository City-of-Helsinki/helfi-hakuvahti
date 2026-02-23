import type { ObjectId } from '@fastify/mongodb';

export type QueueItemType = 'email' | 'sms';

export interface QueueInsertDocument {
  type: QueueItemType;
  atv_id: string;
  content: string;
}

export interface QueueItem extends QueueInsertDocument {
  _id: ObjectId;
}
