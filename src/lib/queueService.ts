import { ObjectId } from '@fastify/mongodb';
import type * as Sentry from '@sentry/node';
import { JSDOM } from 'jsdom';
import type { Db } from 'mongodb';
import type { DialogiClient } from '../plugins/dialogi';
import type { AtvDocumentType } from '../types/atv';
import type { FastifyMailer } from '../types/mailer';
import type { QueueItem, QueueItemType } from '../types/queue';
import type { ATV } from './atv';

export const BATCH_SIZE = 100;

export interface QueueServiceDependencies {
  db: Db;
  atvClient: ATV;
  emailSender: FastifyMailer;
  smsSender: DialogiClient;
  sentry?: typeof Sentry;
  batchSize?: number;
}

type NotificationHandlers = { [key in QueueItemType]: (item: QueueItem, atvDoc?: AtvDocumentType) => Promise<void> };

export class QueueService {
  private readonly queueCollection;
  private readonly atvClient: ATV;
  private readonly emailSender: FastifyMailer;
  private readonly smsSender: DialogiClient;
  private readonly sentry?: typeof Sentry;
  private readonly batchSize: number;

  private handlers: NotificationHandlers;

  constructor(deps: QueueServiceDependencies) {
    this.queueCollection = deps.db.collection('queue');
    this.atvClient = deps.atvClient;
    this.emailSender = deps.emailSender;
    this.smsSender = deps.smsSender;
    this.sentry = deps.sentry;
    this.batchSize = deps.batchSize ?? BATCH_SIZE;
    this.handlers = {
      sms: this.sendSms.bind(this),
      email: this.sendEmail.bind(this),
    };
  }

  async processQueue(): Promise<void> {
    let hasMoreResults = true;

    while (hasMoreResults) {
      const result = (await this.queueCollection.find({}).limit(this.batchSize).toArray()) as QueueItem[];

      if (result.length === 0) {
        hasMoreResults = false;
      } else {
        await this.processBatch(result);
      }
    }
  }

  private async processBatch(batch: QueueItem[]): Promise<void> {
    // Fetch all subscriber data from ATV in one call
    const atvIds = [...new Set(batch.map((item) => item.atv_id))];
    const atvDocuments = await this.atvClient.getDocumentBatch(atvIds);
    const atvMap = new Map<string, AtvDocumentType>();

    atvDocuments.forEach((doc) => {
      if (doc?.id) atvMap.set(doc.id, doc);
    });

    // Process items sequentially
    for (const item of batch) {
      const atvDoc = atvMap.get(item.atv_id);

      if (!this.handlers[item.type]) {
        console.error(`Missing queue handler for type ${item.type}`);
      }

      // Send queued notification.
      await this.handlers[item.type]?.(item, atvDoc);

      // Remove item from queue.
      await this.removeFromQueue(item._id);
    }
  }

  private async sendEmail(item: QueueItem, atvDoc: AtvDocumentType | undefined): Promise<void> {
    const plaintextEmail = atvDoc?.content?.email as string | undefined;
    const dom = new JSDOM(item.content);
    const title = dom.window.document.querySelector('title')?.textContent || 'Untitled';

    console.info('Sending email to', item.atv_id);

    if (!plaintextEmail) {
      console.warn(`Email not found for ATV ID ${item.atv_id}`);
      return;
    }

    try {
      await new Promise((resolve, reject) => {
        this.emailSender.sendMail(
          {
            to: plaintextEmail,
            subject: title,
            html: item.content,
          },
          (errors, info) => {
            if (errors) {
              return reject(new Error(`Sending email to ${item.atv_id} failed.`, { cause: errors }));
            }
            return resolve(info);
          },
        );
      });
    } catch (error) {
      // Continue even if sending email failed.
      this.sentry?.captureException(error);
      console.error(error);
    }
  }

  private async sendSms(item: QueueItem, atvDoc: AtvDocumentType | undefined): Promise<void> {
    const phoneNumber = atvDoc?.content?.sms as string | undefined;

    console.info('Sending SMS to', item.atv_id, item.content);

    if (!phoneNumber) {
      console.warn(`Phone number not found for ATV ID ${item.atv_id}`);
      return;
    }

    try {
      await this.smsSender.sendSms(phoneNumber, item.content);
    } catch (error) {
      // Continue even if sending SMS failed.
      this.sentry?.captureException(error);
      console.error(`Failed to send SMS for ATV ID ${item.atv_id}:`, error);
    }
  }

  private async removeFromQueue(id: ObjectId): Promise<void> {
    const deleteResult = await this.queueCollection.deleteOne({ _id: new ObjectId(id) });

    if (deleteResult.deletedCount === 0) {
      console.error(`Could not delete queue item with id ${id}`);
      throw new Error('Deleting item from queue failed.');
    }
  }
}
