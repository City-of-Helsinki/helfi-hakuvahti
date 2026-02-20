import { ObjectId } from '@fastify/mongodb';
import type { AtvDocumentType } from '../types/atv';
import type { SmsQueueItemType, SmsQueueServiceDependenciesType } from '../types/sms';
import { BaseQueueService } from './baseQueueService';

/**
 * Service for processing SMS queue.
 * Handles fetching SMS from queue, retrieving phone numbers from ATV,
 * sending SMS, and removing processed items from queue.
 */
export class SmsQueueService extends BaseQueueService<SmsQueueItemType> {
  private readonly smsSender: SmsQueueServiceDependenciesType['smsSender'];
  private readonly atvClient: SmsQueueServiceDependenciesType['atvClient'];
  private readonly sentry?: SmsQueueServiceDependenciesType['sentry'];

  constructor(dependencies: SmsQueueServiceDependenciesType) {
    super(dependencies.db.collection('smsqueue'), dependencies.batchSize);
    this.atvClient = dependencies.atvClient;
    this.smsSender = dependencies.smsSender;
    this.sentry = dependencies.sentry;
  }

  /**
   * Process a batch of SMS messages.
   */
  protected async processBatch(batch: SmsQueueItemType[]): Promise<void> {
    // Collect unique ATV document IDs
    const atvIds = [...new Set(batch.map((item) => item.sms))];

    console.info('Sending SMS to atvIds', atvIds);

    // Get SMS phone numbers from ATV in batch
    const atvDocuments: Partial<AtvDocumentType[]> = await this.atvClient.atvGetDocumentBatch(atvIds);

    // Create map of ATV ID -> phone number
    const phoneNumberMap = new Map<string, string>();
    atvDocuments.forEach((doc) => {
      if (doc?.id && doc?.content?.sms) {
        phoneNumberMap.set(doc.id, doc.content.sms);
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

  private async sendSms(
    phoneNumber: string | undefined,
    messageContent: string,
    atvId: string,
    item: SmsQueueItemType,
  ) {
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
