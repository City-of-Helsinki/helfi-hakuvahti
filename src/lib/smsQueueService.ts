import { ObjectId } from '@fastify/mongodb';
import type * as Sentry from '@sentry/node';
import type { FastifyInstance } from 'fastify';
import type { Db } from 'mongodb';
import type { DialogiClient } from '../plugins/dialogi';
import type { AtvDocumentType } from '../types/atv';
import { type BaseQueueItem, BaseQueueService } from './baseQueueService';

export interface SmsQueueItem extends BaseQueueItem {
  _id: ObjectId;
  sms: string; // This is the ATV document ID
  content: string; // SMS message content
}

export interface SmsQueueServiceDependencies {
  db: Db;
  atvClient: FastifyInstance;
  smsSender: DialogiClient;
  sentry?: typeof Sentry;
  batchSize?: number;
}

/**
 * Service for processing SMS queue.
 * Handles fetching SMS from queue, retrieving phone numbers from ATV,
 * sending SMS, and removing processed items from queue.
 */
export class SmsQueueService extends BaseQueueService<SmsQueueItem> {
  private readonly smsSender: DialogiClient;
  private readonly atvClient: FastifyInstance;
  private readonly sentry?: typeof Sentry;

  constructor(dependencies: SmsQueueServiceDependencies) {
    super(dependencies.db.collection('smsqueue'), dependencies.batchSize);
    this.atvClient = dependencies.atvClient;
    this.smsSender = dependencies.smsSender;
    this.sentry = dependencies.sentry;
  }

  /**
   * Process a batch of SMS messages.
   */
  protected async processBatch(batch: SmsQueueItem[]): Promise<void> {
    // Collect unique ATV document IDs
    const atvIds = [...new Set(batch.map((item) => item.sms))];

    // Get SMS phone numbers from ATV in batch
    const atvDocuments: Partial<AtvDocumentType[]> = await this.atvClient.atvGetDocumentBatch(atvIds);

    // Create map of ATV ID -> phone number
    const phoneNumberMap = new Map<string, string>();
    atvDocuments.forEach((doc) => {
      if (doc?.id && doc?.content) {
        try {
          const content = JSON.parse(doc.content);
          if (content.sms) {
            phoneNumberMap.set(doc.id, content.sms);
          }
        } catch (error) {
          console.error(`Failed to parse ATV document ${doc.id}:`, error);
        }
      }
    });

    // Process SMS messages sequentially
    await batch.reduce(async (previousPromise, smsItem) => {
      await previousPromise;

      const atvId = smsItem.sms;
      const phoneNumber = phoneNumberMap.get(atvId);
      const messageContent = smsItem.content;

      await this.sendSms(phoneNumber, messageContent, atvId, smsItem);

      return Promise.resolve();
    }, Promise.resolve());
  }

  private async sendSms(phoneNumber: string | undefined, messageContent: string, atvId: string, item: SmsQueueItem) {
    console.info('Processing SMS for ATV ID:', atvId);

    if (phoneNumber) {
      try {
        await this.smsSender.sendSms(phoneNumber, messageContent);
        console.log(`SMS sent successfully for ATV ID: ${atvId}`);
      } catch (error) {
        // Log error but continue processing queue
        this.sentry?.captureException(error);
        console.error(`Failed to send SMS for ATV ID ${atvId}:`, error);
      }
    } else {
      console.warn(`Phone number not found for ATV ID ${atvId}`);
    }

    // Remove from queue regardless of send status
    const deleteResult = await this.queueCollection.deleteOne({
      _id: new ObjectId(item._id),
    });

    if (deleteResult.deletedCount === 0) {
      console.error(`Failed to delete SMS queue item ${item._id}`);
      throw new Error('Deleting SMS from queue failed.');
    }
  }
}
