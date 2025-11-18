import command from '../lib/command';
import atv from '../plugins/atv';
import mailer from '../plugins/mailer';
import mongodb from '../plugins/mongodb';
import '../plugins/sentry';
import { EmailQueueService } from '../lib/emailQueueService';

// Command line/cron application to send all emails from queue collection
command(
  async (server) => {
    const checkInId = server.Sentry?.captureCheckIn({
      monitorSlug: 'hav-send-emails-in-queue',
      status: 'in_progress',
    });

    if (typeof server.mongo?.db === 'undefined') {
      throw new Error('MongoDB connection not working');
    }

    // Create email queue service with dependencies
    const emailQueueService = new EmailQueueService({
      db: server.mongo.db,
      atvClient: server,
      emailSender: server.mailer,
      sentry: server.Sentry,
    });

    // Process the email queue
    await emailQueueService.processQueue();

    server.Sentry?.captureCheckIn({
      checkInId,
      monitorSlug: 'hav-send-emails-in-queue',
      status: 'ok',
    });
  },
  [
    // Register only needed plugins
    mailer,
    mongodb,
    atv,
  ],
);
