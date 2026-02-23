import * as assert from 'node:assert';
import { after, before, beforeEach, describe, mock, test } from 'node:test';
import { ObjectId } from '@fastify/mongodb';
import type { FastifyInstance } from 'fastify';
import { MongoClient } from 'mongodb';
import { QueueService } from '../../src/lib/queueService';
import '../../src/plugins/atv';
import type { FastifyMailer } from '../../src/types/mailer';

describe('QueueService', () => {
  assert.ok(process.env.MONGODB);
  const mongo = new MongoClient(process.env.MONGODB);

  const emailSender = {
    sendMail: mock.fn<FastifyMailer['sendMail']>(),
  };

  const smsSender = {
    sendSms: mock.fn<(phoneNumber: string, message: string) => Promise<void>>(),
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

  beforeEach(async () => {
    emailSender.sendMail.mock.restore();
    smsSender.sendSms.mock.restore();
    atv.atvGetDocumentBatch.mock.restore();

    // Delete all items.
    await mongo.db().collection('queue').deleteMany({});
  });

  test('Sends emails correctly', { concurrency: false }, async () => {
    const db = mongo.db();
    const item = await db.collection('queue').insertOne({
      _id: new ObjectId(),
      type: 'email',
      atv_id: '123',
      content: '<html><head><title>Test Email</title></head><body>Hello</body></html>',
    });

    atv.atvGetDocumentBatch.mock.mockImplementation(() =>
      Promise.resolve([
        {
          // Id that matches atv_id field in queue collection.
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
      assert.strictEqual(options.to, 'test@example.com', 'Email To matches the expected value');

      callback?.(null, {
        messageId: 'test-id',
      });
    }) as any);

    const sut = new QueueService({
      db,
      atvClient: atv as any,
      emailSender: emailSender as any,
      smsSender: smsSender as any,
    });

    await sut.processQueue();

    // Assert that email was sent.
    assert.ok(emailSender.sendMail.mock.callCount() >= 1);

    const result = await db.collection('queue').findOne({
      _id: item.insertedId,
    });

    // Assert that item was deleted.
    assert.ok(result === null, 'Queue item was deleted');
  });

  test('Sends SMS correctly', { concurrency: false }, async () => {
    const db = mongo.db();
    const item = await db.collection('queue').insertOne({
      _id: new ObjectId(),
      type: 'sms',
      atv_id: '456',
      content: 'Hello SMS',
    });

    atv.atvGetDocumentBatch.mock.mockImplementation(() =>
      Promise.resolve([
        {
          // Id that matches atv_id field in queue collection.
          id: '456',
          tos_function_id: 'a',
          tos_record_id: 'b',
          content: {
            sms: '+358401234567',
          },
        },
      ]),
    );

    smsSender.sendSms.mock.mockImplementation((phoneNumber: string, message: string): Promise<void> => {
      assert.strictEqual(phoneNumber, '+358401234567', 'SMS recipient matches the expected value');
      assert.strictEqual(message, 'Hello SMS');

      return Promise.resolve();
    });

    const sut = new QueueService({
      db,
      atvClient: atv as any,
      emailSender: emailSender as any,
      smsSender: smsSender as any,
    });

    await sut.processQueue();

    // Assert that SMS was sent.
    assert.ok(smsSender.sendSms.mock.callCount() >= 1);

    const result = await db.collection('queue').findOne({
      _id: item.insertedId,
    });

    // Assert that item was deleted.
    assert.ok(result === null, 'Queue item was deleted');
  });
});
