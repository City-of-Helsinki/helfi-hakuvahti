import { ObjectId } from '@fastify/mongodb';
import command from '../lib/command';
import atv from '../plugins/atv';
import dialogi from '../plugins/dialogi';
import mongodb from '../plugins/mongodb';
import '../plugins/sentry';
import type { AtvDocumentType } from '../types/atv';

// Command line/cron application to send all SMS from queue collection
const BATCH_SIZE = 100;

command(
  async (server) => {
    const checkInId = server.Sentry?.captureCheckIn({
      monitorSlug: 'hav-send-sms-in-queue',
      status: 'in_progress',
    });

    const db = server.mongo?.db;
    if (!db) {
      throw new Error('MongoDB connection not available');
    }

    const smsQueueCollection = db.collection('smsqueue');
    let hasMoreResults = true;

    while (hasMoreResults) {
      // eslint-disable-next-line no-await-in-loop
      const batch = await smsQueueCollection.find({}).limit(BATCH_SIZE).toArray();

      if (batch.length === 0) {
        hasMoreResults = false;
        break;
      }

      // Collect unique ATV document IDs
      const atvIds = [...new Set(batch.map((item) => item.sms))];

      // Get SMS phone numbers from ATV in batch
      // eslint-disable-next-line no-await-in-loop
      const atvDocuments: Partial<AtvDocumentType[]> = await server.atvGetDocumentBatch(atvIds);

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
      // eslint-disable-next-line no-await-in-loop
      await batch.reduce(async (previousPromise, smsItem) => {
        await previousPromise;

        const atvId = smsItem.sms;
        const phoneNumber = phoneNumberMap.get(atvId);
        const messageContent = smsItem.content;

        console.info('Processing SMS for ATV ID:', atvId);

        if (phoneNumber) {
          try {
            // Send SMS using Dialogi plugin
            await server.dialogi.sendSms(phoneNumber, messageContent);
            console.log(`SMS sent successfully for ATV ID: ${atvId}`);
          } catch (error) {
            // Log error but continue processing queue
            server.Sentry?.captureException(error);
            console.error(`Failed to send SMS for ATV ID ${atvId}:`, error);
          }
        } else {
          console.warn(`Phone number not found for ATV ID ${atvId}`);
        }

        // Remove from queue regardless of send status
        const deleteResult = await smsQueueCollection.deleteOne({
          _id: new ObjectId(smsItem._id),
        });

        if (deleteResult.deletedCount === 0) {
          console.error(`Failed to delete SMS queue item ${smsItem._id}`);
        }

        return Promise.resolve();
      }, Promise.resolve());
    }

    server.Sentry?.captureCheckIn({
      checkInId,
      monitorSlug: 'hav-send-sms-in-queue',
      status: 'ok',
    });
  },
  [
    // Register only needed plugins
    mongodb,
    atv,
    dialogi,
  ],
);
