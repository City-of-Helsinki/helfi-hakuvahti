import command from '../lib/command';
import { QueueService } from '../lib/queueService';
import atv from '../plugins/atv';
import dialogi from '../plugins/dialogi';
import mailer from '../plugins/mailer';
import mongodb from '../plugins/mongodb';
import '../plugins/sentry';

// Command line/cron application to send all notifications from queue collection
command(
  async (server) => {
    const checkInId = server.Sentry?.captureCheckIn({
      monitorSlug: 'hav-send-queue',
      status: 'in_progress',
    });

    if (typeof server.mongo?.db === 'undefined') {
      throw new Error('MongoDB connection not working');
    }

    const queueService = new QueueService({
      db: server.mongo.db,
      atvClient: server.atv,
      emailSender: server.mailer,
      smsSender: server.dialogi,
      sentry: server.Sentry,
    });

    await queueService.processQueue();

    server.Sentry?.captureCheckIn({
      checkInId,
      monitorSlug: 'hav-send-queue',
      status: 'ok',
    });
  },
  [mailer, mongodb, atv, dialogi],
);
