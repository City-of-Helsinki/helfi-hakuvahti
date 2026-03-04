import * as assert from 'node:assert';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ObjectId } from '@fastify/mongodb';
import { Int32, MongoClient } from 'mongodb';
import type { ATV } from '../../src/lib/atv';
import {
  ActionError,
  confirmSubscription,
  deleteSubscription,
  renewSubscription,
} from '../../src/lib/subscriptionActions';
import { type SubscriptionCollectionType, SubscriptionStatus } from '../../src/types/subscription';

describe('subscriptionActions', () => {
  assert.ok(process.env.MONGODB);
  const mongo = new MongoClient(process.env.MONGODB);

  before(async () => {
    await mongo.connect();
  });

  after(async () => {
    await mongo.close();
  });

  beforeEach(async () => {
    await mongo.db().collection<SubscriptionCollectionType>('subscription').deleteMany({});
  });

  // Helper to insert a subscription (matching MongoDB JSON Schema validation)
  const insertSubscription = async (data: Record<string, unknown> = {}) => {
    const id = new ObjectId();
    const now = new Date();
    await mongo.db().collection<SubscriptionCollectionType>('subscription').insertOne({
      _id: id,
      email: 'test-atv-doc-id',
      atv_id: 'test-atv-doc-id',
      elastic_query: 'test-query',
      query: '/search?q=test',
      site_id: 'rekry',
      hash: 'test-hash',
      lang: 'fi',
      status: SubscriptionStatus.INACTIVE,
      expiry_notification_sent: SubscriptionStatus.INACTIVE,
      created: now,
      modified: now,
      sms_code: '123456',
      sms_code_created: now,
      ...data,
    } as SubscriptionCollectionType);
    return id;
  };

  describe('confirmSubscription', () => {
    test('confirms SMS subscription with sms_confirmed: false and clears SMS fields', async () => {
      const beforeConfirm = new Date();
      const id = await insertSubscription({ sms_confirmed: false });
      const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

      await confirmSubscription(collection, { _id: id }, 'sms');

      const doc = await collection.findOne({ _id: id });
      assert.ok(doc);
      assert.strictEqual(doc.status, SubscriptionStatus.ACTIVE);
      assert.strictEqual(doc.sms_confirmed, true);
      assert.strictEqual(doc.sms_code, undefined);
      assert.strictEqual(doc.sms_code_created, undefined);
      assert.ok(doc.modified >= beforeConfirm, 'modified should be updated');
    });

    test('confirms email subscription without touching SMS fields', async () => {
      const id = await insertSubscription({ email_confirmed: false, sms_confirmed: false });
      const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

      await confirmSubscription(collection, { _id: id }, 'email');

      const doc = await collection.findOne({ _id: id });
      assert.ok(doc);
      assert.strictEqual(doc.status, SubscriptionStatus.ACTIVE);
      assert.strictEqual(doc.email_confirmed, true);
      assert.strictEqual(doc.sms_confirmed, false, 'sms_confirmed should remain false');
      // SMS fields should not be cleared for email confirmation
      assert.strictEqual(doc.sms_code, '123456');
      assert.ok(doc.sms_code_created);
    });

    test('throws 404 when subscription is already confirmed', async () => {
      const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

      // Already confirmed (sms_confirmed: true)
      const confirmedId = await insertSubscription({
        status: new Int32(SubscriptionStatus.ACTIVE),
        sms_confirmed: true,
      });
      await assert.rejects(() => confirmSubscription(collection, { _id: confirmedId }, 'sms'), (error: ActionError) => {
        assert.strictEqual(error.statusCode, 404);
        return true;
      });

      // Non-existent
      await assert.rejects(() => confirmSubscription(collection, { _id: new ObjectId() }, 'sms'), (error: ActionError) => {
        assert.strictEqual(error.statusCode, 404);
        return true;
      });
    });

    test('confirming SMS does not set email_confirmed', async () => {
      const id = await insertSubscription({ sms_confirmed: false, email_confirmed: false });
      const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

      await confirmSubscription(collection, { _id: id }, 'sms');

      const doc = await collection.findOne({ _id: id });
      assert.ok(doc);
      assert.strictEqual(doc.sms_confirmed, true);
      assert.strictEqual(doc.email_confirmed, false, 'email_confirmed should remain false');
    });
  });

  describe('deleteSubscription', () => {
    test('deletes existing subscription', async () => {
      const id = await insertSubscription();
      const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

      await deleteSubscription(collection, { _id: id });

      assert.strictEqual(await collection.findOne({ _id: id }), null);
    });

    test('throws 404 for non-existent subscription', async () => {
      const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

      await assert.rejects(() => deleteSubscription(collection, { _id: new ObjectId() }), (error: ActionError) => {
        assert.strictEqual(error.statusCode, 404);
        return true;
      });
    });
  });

  describe('renewSubscription', () => {
    const noOpAtv = { updateDocumentDeleteAfter: async () => ({}) } as unknown as ATV;

    test('throws 400 for non-ACTIVE or not-yet-renewable subscriptions', async () => {
      const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

      // Non-ACTIVE subscription
      const inactiveId = await insertSubscription();
      await assert.rejects(() => renewSubscription(collection, { _id: inactiveId }, noOpAtv), (error: ActionError) => {
        assert.strictEqual(error.statusCode, 400);
        return true;
      });

      // ACTIVE but outside renewal window (just created)
      const activeId = await insertSubscription({ status: new Int32(SubscriptionStatus.ACTIVE) });
      await assert.rejects(() => renewSubscription(collection, { _id: activeId }, noOpAtv), (error: ActionError) => {
        assert.strictEqual(error.statusCode, 400);
        return true;
      });
    });

    test('throws 500 when ATV update fails during renewal', async () => {
      const created = new Date(Date.now() - 88 * 24 * 60 * 60 * 1000);
      const id = await insertSubscription({ status: new Int32(SubscriptionStatus.ACTIVE), created });
      const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

      const failingAtv = {
        updateDocumentDeleteAfter: async () => { throw new Error('ATV unavailable'); },
      } as unknown as ATV;

      await assert.rejects(() => renewSubscription(collection, { _id: id }, failingAtv), (error: ActionError) => {
        assert.strictEqual(error.statusCode, 500);
        return true;
      });
    });

    test('successfully renews and updates all fields', async () => {
      const created = new Date(Date.now() - 88 * 24 * 60 * 60 * 1000);
      const id = await insertSubscription({
        status: new Int32(SubscriptionStatus.ACTIVE),
        created,
        expiry_notification_sent: new Int32(1),
        sms_code: '654321',
        sms_code_created: new Date(),
      });
      const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

      await renewSubscription(collection, { _id: id }, noOpAtv);

      const doc = await collection.findOne({ _id: id });
      assert.ok(doc);

      // Modified date should be refreshed
      assert.ok(Date.now() - new Date(doc.modified).getTime() < 60 * 1000);
      // Expiry notification reset
      assert.strictEqual(doc.expiry_notification_sent, SubscriptionStatus.INACTIVE);
      // delete_after set
      assert.ok(doc.delete_after);
      // SMS fields cleared
      assert.strictEqual(doc.sms_code, undefined);
      assert.strictEqual(doc.sms_code_created, undefined);
    });
  });
});
