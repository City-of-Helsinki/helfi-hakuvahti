import * as assert from 'node:assert';
import { after, before, beforeEach, describe, mock, test } from 'node:test';
import { MongoClient } from 'mongodb';
import { EmailQueueService } from '../../src/lib/emailQueueService';
import '../../src/plugins/atv';
import { ObjectId } from '@fastify/mongodb';
import type { FastifyInstance } from 'fastify';
import type { FastifyMailer } from '../../src/types/mailer';

describe('EmailQueueService', () => {
  assert.ok(process.env.MONGODB);
  const mongo = new MongoClient(process.env.MONGODB);

  const emailSender = {
    sendMail: mock.fn<FastifyMailer['sendMail']>(),
  };

  const atv = {
    atvGetDocumentBatch: mock.fn<FastifyInstance['atvGetDocumentBatch']>(),
  };

  before(async () => {
    await mongo.connect();
  });

  after(async () => {
    await mongo.close();
  });

  beforeEach(() => {
    emailSender.sendMail.mock.restore();
    atv.atvGetDocumentBatch.mock.restore();

    // Delete all items.
    mongo.db().collection('queue').deleteMany({});
  });

  test('Sends emails correctly', { concurrency: false }, async () => {
    const db = mongo.db();
    const item = await db.collection('queue').insertOne({
      _id: new ObjectId(),
      email: '123',
      content: 'Hello',
    });

    atv.atvGetDocumentBatch.mock.mockImplementation(() =>
      Promise.resolve([
        {
          // Id that matches email field in queue collection.
          id: '123',
          tos_function_id: 'a',
          tos_record_id: 'b',
          content: {
            email: 'test@example.com',
          },
        },
      ]),
    );

    emailSender.sendMail.mock.mockImplementation(((
      options: any,
      callback?: (err: Error | null, info: any) => void,
    ): void => {
      assert.strictEqual(options.to, 'test@example.com');

      callback?.(null, {
        messageId: 'test-id',
      });
    }) as any);

    const sut = new EmailQueueService({
      db,
      atvClient: atv as any,
      emailSender: emailSender as any,
    });

    await sut.processQueue();

    // Assert that email was sent.
    assert.ok(emailSender.sendMail.mock.callCount() >= 1);

    const result = await db.collection('queue').findOne({
      _id: item.insertedId,
    });

    // Assert that item was deleted.
    assert.ok(result === null);
  });
});
