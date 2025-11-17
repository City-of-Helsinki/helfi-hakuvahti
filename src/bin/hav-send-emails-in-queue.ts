import { ObjectId } from '@fastify/mongodb';
import { JSDOM } from 'jsdom';
import command from '../lib/command';
import atv from '../plugins/atv';
import mailer from '../plugins/mailer';
import mongodb from '../plugins/mongodb';
import '../plugins/sentry';
import type { AtvDocumentType } from '../types/atv';

// Command line/cron application to send all emails from queue collection
const BATCH_SIZE = 100;

command(
  async (server) => {
    const checkInId = server.Sentry?.captureCheckIn({ monitorSlug: 'hav-send-emails-in-queue', status: 'in_progress' });

    if (typeof server.mongo?.db === 'undefined') {
      console.error('MongoDB connection not working');
      throw new Error('MongoDB connection not working');
    }

    // Email queue
    const queueCollection = server.mongo.db?.collection('queue');

    let hasMoreResults = true;

    while (hasMoreResults) {
      // eslint-disable-next-line no-await-in-loop
      const result = await queueCollection.find({}).limit(BATCH_SIZE).toArray();

      if (result.length === 0) {
        hasMoreResults = false;
      } else {
        // Collect email ids as map
        const emailIdsMap = new Map<string, string | null>();

        result.forEach((email) => {
          emailIdsMap.set(email.email, null);
        });

        // Get batch of email documents from ATV
        const emailIds = [...emailIdsMap.keys()];
        // eslint-disable-next-line no-await-in-loop
        const emailDocuments: Partial<AtvDocumentType[]> = await server.atvGetDocumentBatch(emailIds);

        // Update the email map with unencrypted email list
        if (emailDocuments.length > 0) {
          emailDocuments.forEach((emailDocument) => {
            if (emailDocument?.id) {
              emailIdsMap.set(emailDocument.id, emailDocument.content.email);
            }
          });
        }

        // Send emails sequentially to avoid overwhelming the system
        // eslint-disable-next-line no-await-in-loop
        await result.reduce(async (previousPromise, email) => {
          await previousPromise;

          const atvId = email.email;
          const plaintextEmail = emailIdsMap.get(email.email);
          const dom = new JSDOM(email.content);
          const title = dom.window.document.querySelector('title')?.textContent || 'Untitled';

          // email.email is the ATV document id.
          console.info('Sending email to', atvId);

          // Check that plaintextEmail was found. No sure how this can happen,
          // maybe the ATV document was deleted before the email queue was empty?
          // Anyway, if email document was not found, sending email will fail.
          if (plaintextEmail) {
            try {
              await new Promise((resolve, reject) => {
                server.mailer.sendMail(
                  {
                    to: plaintextEmail,
                    subject: title,
                    html: email.content,
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
              server.Sentry?.captureException(error);

              console.error(error);
            }
          }

          // Remove document from queue. The document is removed
          // event if the email sending does not succeed.
          const deleteResult = await queueCollection.deleteOne({ _id: new ObjectId(email._id) });
          if (deleteResult.deletedCount === 0) {
            console.error(`Could not delete email document with id ${email._id} from queue`);

            throw new Error('Deleting email from queue failed.');
          }

          return Promise.resolve();
        }, Promise.resolve());
      }
    }

    server.Sentry?.captureCheckIn({ checkInId, monitorSlug: 'hav-send-emails-in-queue', status: 'ok' });
  },
  [
    // Register only needed plugins
    mailer,
    mongodb,
    atv,
  ],
);
