import * as Sentry from '@sentry/node';
import command from '../lib/command.ts';
import { QueueService } from '../lib/queueService.ts';
import atv from '../plugins/atv.ts';
import dialogi from '../plugins/dialogi.ts';
import mailer from '../plugins/mailer.ts';
import mongodb from '../plugins/mongodb.ts';

// Command line/cron application to send all notifications from queue collection
command(
  async (server) => {
    const checkInId = Sentry.captureCheckIn({
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
    });

    await queueService.processQueue();

    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: 'hav-send-queue',
      status: 'ok',
    });
  },
  [mailer, mongodb, atv, dialogi],
);
