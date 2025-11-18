import { ObjectId } from '@fastify/mongodb';
import type * as Sentry from '@sentry/node';
import type { FastifyInstance } from 'fastify';
import { JSDOM } from 'jsdom';
import type { Collection, Db } from 'mongodb';
import type { FastifyMailer } from '../types/mailer';

export const BATCH_SIZE = 100;

export interface EmailQueueItem {
  _id: ObjectId;
  email: string; // This is the ATV document ID
  content: string; // HTML content
}

export interface EmailQueueServiceDependencies {
  db: Db;
  atvClient: FastifyInstance;
  emailSender: FastifyMailer;
  sentry?: typeof Sentry;
  batchSize?: number;
}

/**
 * Service for processing email queue.
 * Handles fetching emails from queue, retrieving plaintext emails from ATV,
 * sending emails, and removing processed items from queue.
 */
export class EmailQueueService {
  private readonly queueCollection: Collection;
  private readonly emailSender: FastifyMailer;
  private readonly atvClient: FastifyInstance;
  private readonly sentry?: typeof Sentry;
  private readonly batchSize: number;

  constructor(dependencies: EmailQueueServiceDependencies) {
    this.queueCollection = dependencies.db.collection('queue');
    this.atvClient = dependencies.atvClient;
    this.emailSender = dependencies.emailSender;
    this.sentry = dependencies.sentry;
    this.batchSize = dependencies.batchSize ?? BATCH_SIZE;
  }

  /**
   * Process all emails in the queue in batches.
   */
  async processQueue(): Promise<void> {
    let hasMoreResults = true;

    while (hasMoreResults) {
      const result = (await this.queueCollection.find({}).limit(this.batchSize).toArray()) as EmailQueueItem[];

      if (result.length === 0) {
        hasMoreResults = false;
      } else {
        await this.processBatch(result);
      }
    }
  }

  /**
   * Process a batch of emails.
   */
  private async processBatch(batch: EmailQueueItem[]): Promise<void> {
    // Collect unique email ATV IDs
    const emailIdsMap = new Map<string, string | null>();
    batch.forEach((email) => {
      emailIdsMap.set(email.email, null);
    });

    // Get batch of email documents from ATV
    const emailIds = [...emailIdsMap.keys()];
    const emailDocuments = await this.atvClient.atvGetDocumentBatch(emailIds);

    // Update the email map with unencrypted email addresses
    if (emailDocuments.length > 0) {
      emailDocuments.forEach((emailDocument) => {
        if (emailDocument?.id) {
          emailIdsMap.set(emailDocument.id, emailDocument.content.email);
        }
      });
    }

    // Send emails sequentially to avoid overwhelming the system
    await batch.reduce(async (previousPromise, email) => {
      await previousPromise;

      const plaintextEmail = emailIdsMap.get(email.email);
      await this.sendEmail(plaintextEmail, email);

      return Promise.resolve();
    }, Promise.resolve());
  }

  private async sendEmail(plaintextEmail: string | null | undefined, item: EmailQueueItem) {
    const atvId = item.email;
    const dom = new JSDOM(item.content);
    const title = dom.window.document.querySelector('title')?.textContent || 'Untitled';

    // email.email is the ATV document id.
    console.info('Sending email to', atvId);

    // Check that plaintextEmail was found. No sure how this can happen,
    // maybe the ATV document was deleted before the email queue was empty?
    // Anyway, if email document was not found, sending email will fail.
    if (plaintextEmail) {
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
                return reject(new Error(`Sending email to ${atvId} failed.`, { cause: errors }));
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

    // Remove document from queue. The document is removed
    // event if the email sending does not succeed.
    const deleteResult = await this.queueCollection.deleteOne({ _id: new ObjectId(item._id) });
    if (deleteResult.deletedCount === 0) {
      console.error(`Could not delete email document with id ${item._id} from queue`);

      throw new Error('Deleting email from queue failed.');
    }
  }
}
