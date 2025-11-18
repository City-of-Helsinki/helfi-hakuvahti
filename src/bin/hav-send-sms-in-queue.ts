import command from '../lib/command';
import atv from '../plugins/atv';
import dialogi from '../plugins/dialogi';
import mongodb from '../plugins/mongodb';
import '../plugins/sentry';
import { SmsQueueService } from '../lib/smsQueueService';

// Command line/cron application to send all SMS from queue collection
command(
  async (server) => {
    const checkInId = server.Sentry?.captureCheckIn({
      monitorSlug: 'hav-send-sms-in-queue',
      status: 'in_progress',
    });

    if (typeof server.mongo?.db === 'undefined') {
      throw new Error('MongoDB connection not working');
    }

    // Create SMS queue service with dependencies
    const smsQueueService = new SmsQueueService({
      db: server.mongo.db,
      atvClient: server,
      smsSender: server.dialogi,
      sentry: server.Sentry,
    });

    // Process the SMS queue
    await smsQueueService.processQueue();

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
