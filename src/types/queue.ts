import type { ObjectId } from '@fastify/mongodb';

/**
 * Notification types drained and sent by QueueService. The queue
 * collection also stores broadcast status records.
 */
export const QUEUE_ITEM_TYPES = ['email', 'sms'] as const;

export type QueueItemType = (typeof QUEUE_ITEM_TYPES)[number];

export interface QueueInsertDocument {
  type: QueueItemType;
  atv_id: string;
  content: string;
}

export interface QueueItem extends QueueInsertDocument {
  _id: ObjectId;
}
