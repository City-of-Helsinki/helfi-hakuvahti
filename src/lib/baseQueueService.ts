import type { ObjectId } from '@fastify/mongodb';
import type { Collection } from 'mongodb';

export const BATCH_SIZE = 100;

export interface BaseQueueItem {
  _id: ObjectId;
}

/**
 * Base class for queue processing services.
 * Implements the common pattern of fetching items in batches and processing them.
 */
export abstract class BaseQueueService<T extends BaseQueueItem> {
  protected readonly queueCollection: Collection;
  protected readonly batchSize: number;

  protected constructor(queueCollection: Collection, batchSize = BATCH_SIZE) {
    this.queueCollection = queueCollection;
    this.batchSize = batchSize;
  }

  /**
   * Process all items in the queue in batches.
   */
  async processQueue(): Promise<void> {
    let hasMoreResults = true;

    while (hasMoreResults) {
      const result = (await this.queueCollection.find({}).limit(this.batchSize).toArray()) as T[];

      if (result.length === 0) {
        hasMoreResults = false;
      } else {
        await this.processBatch(result);
      }
    }
  }

  /**
   * Process a batch of items from the queue.
   * Must be implemented by subclasses to define specific processing logic.
   */
  protected abstract processBatch(batch: T[]): Promise<void>;
}
