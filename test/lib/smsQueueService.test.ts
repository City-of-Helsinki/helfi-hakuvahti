import * as assert from 'node:assert';
import { after, before, beforeEach, describe, mock, test } from 'node:test';
import { MongoClient } from 'mongodb';
import { SmsQueueService } from '../../src/lib/smsQueueService';
import '../../src/plugins/atv';
import { ObjectId } from '@fastify/mongodb';
import type { FastifyInstance } from 'fastify';

describe('SmsQueueService', () => {
  assert.ok(process.env.MONGODB);
  const mongo = new MongoClient(process.env.MONGODB);

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
    smsSender.sendSms.mock.restore();
    atv.atvGetDocumentBatch.mock.restore();

    // Delete all items.
    await mongo.db().collection('smsqueue').deleteMany({});
  });

  test('Sends SMS correctly', { concurrency: false }, async () => {
    const db = mongo.db();
    const item = await db.collection('smsqueue').insertOne({
      _id: new ObjectId(),
      sms: '123',
      content: 'Hello, this is a test SMS message',
    });

    atv.atvGetDocumentBatch.mock.mockImplementation(() =>
      Promise.resolve([
        {
          // Id that matches sms field in smsqueue collection.
          id: '123',
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
      assert.strictEqual(message, 'Hello, this is a test SMS message');

      return Promise.resolve();
    });

    const sut = new SmsQueueService({
      db,
      atvClient: atv as any,
      smsSender: smsSender as any,
    });

    await sut.processQueue();

    // Assert that SMS was sent.
    assert.ok(smsSender.sendSms.mock.callCount() >= 1);

    const result = await db.collection('smsqueue').findOne({
      _id: item.insertedId,
    });

    // Assert that item was deleted.
    assert.ok(result === null, 'Queue item was deleted');
  });
});
