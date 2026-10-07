import * as assert from 'node:assert';
import { after, before, beforeEach, describe, mock, test } from 'node:test';
import { ObjectId } from '@fastify/mongodb';
import { MongoClient } from 'mongodb';
import type { ATV } from '../../src/lib/atv.ts';
import { QueueService } from '../../src/lib/queueService.ts';
import type { FastifyMailer } from '../../src/types/mailer.ts';
import { atvId } from './utils.ts';

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
    getDocumentBatch: mock.fn<ATV['getDocumentBatch']>(),
  };

  before(async () => {
    await mongo.connect();
  });

  after(async () => {
    await mongo.close();
  });

  beforeEach(async () => {
    emailSender.sendMail.mock.restore();
    emailSender.sendMail.mock.resetCalls();
    smsSender.sendSms.mock.restore();
    smsSender.sendSms.mock.resetCalls();
    atv.getDocumentBatch.mock.restore();
    atv.getDocumentBatch.mock.resetCalls();

    // Delete all items.
    await mongo.db().collection('queue').deleteMany({});
  });

  test('Sends emails correctly', { concurrency: false }, async () => {
    const db = mongo.db();
    const item = await db.collection('queue').insertOne({
      _id: new ObjectId(),
      type: 'email',
      atv_id: atvId('email-subscriber'),
      content: '<html><head><title>Test Email</title></head><body>Hello</body></html>',
    });

    atv.getDocumentBatch.mock.mockImplementation(() =>
      Promise.resolve([
        {
          // Id that matches atv_id field in queue collection.
          id: atvId('email-subscriber'),
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
      atv_id: atvId('sms-subscriber'),
      content: 'Hello SMS',
    });

    atv.getDocumentBatch.mock.mockImplementation(() =>
      Promise.resolve([
        {
          // Id that matches atv_id field in queue collection.
          id: atvId('sms-subscriber'),
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

  test('Drops items whose atv_id is not an ATV document id and delivers the rest', { concurrency: false }, async () => {
    const db = mongo.db();
    const valid = [atvId('first'), atvId('second')];
    await db.collection('queue').insertMany([
      { type: 'email', atv_id: valid[0], content: '<title>a</title>' },
      { type: 'email', atv_id: '', content: '<title>b</title>' },
      { type: 'sms', atv_id: 'someone@example.com', content: 'c' },
      { type: 'email', atv_id: valid[1], content: '<title>d</title>' },
    ]);

    atv.getDocumentBatch.mock.mockImplementation((ids: string[]) =>
      Promise.resolve(ids.map((id) => ({ id, content: { email: `${id}@example.com` } })) as any),
    );
    emailSender.sendMail.mock.mockImplementation(((
      _options: any,
      callback?: (err: Error | null, info: any) => void,
    ): void => callback?.(null, {})) as any);
    const consoleError = mock.method(console, 'error', () => {});

    try {
      await new QueueService({
        db,
        atvClient: atv as any,
        emailSender: emailSender as any,
        smsSender: smsSender as any,
      }).processQueue();
    } finally {
      consoleError.mock.restore();
    }

    // A single invalid id would make ATV reject the whole lookup.
    assert.deepStrictEqual(atv.getDocumentBatch.mock.calls[0]?.arguments[0], valid);
    assert.deepStrictEqual(
      emailSender.sendMail.mock.calls.map((call) => (call.arguments[0] as any).to),
      valid.map((id) => `${id}@example.com`),
    );
    assert.strictEqual(consoleError.mock.callCount(), 2, 'Each dropped item is reported');
    assert.strictEqual(await db.collection('queue').countDocuments(), 0, 'Dropped items are removed');
  });

  test('Does not call ATV when no item has a valid atv_id', { concurrency: false }, async () => {
    const db = mongo.db();
    await db.collection('queue').insertOne({ type: 'email', atv_id: 'atv-a', content: '<title>a</title>' });
    const consoleError = mock.method(console, 'error', () => {});

    try {
      await new QueueService({
        db,
        atvClient: atv as any,
        emailSender: emailSender as any,
        smsSender: smsSender as any,
      }).processQueue();
    } finally {
      consoleError.mock.restore();
    }

    // ATV answers 400 to an empty list.
    assert.strictEqual(atv.getDocumentBatch.mock.callCount(), 0);
    assert.strictEqual(await db.collection('queue').countDocuments(), 0);
  });
});
