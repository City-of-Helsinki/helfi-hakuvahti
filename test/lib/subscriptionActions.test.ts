import * as assert from 'node:assert';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ObjectId } from '@fastify/mongodb';
import { Int32, MongoClient } from 'mongodb';
import {
  type AtvUpdateFn,
  confirmSubscription,
  deleteSubscription,
  renewSubscription,
} from '../../src/lib/subscriptionActions';
import type { SiteConfigurationType } from '../../src/types/siteConfig';
import { SubscriptionStatus } from '../../src/types/subscription';

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
    await mongo.db().collection('subscription').deleteMany({});
  });

  // Helper to insert a subscription (matching MongoDB JSON Schema validation)
  const insertSubscription = async (data: Record<string, unknown> = {}) => {
    const id = new ObjectId();
    const now = new Date();
    await mongo.db().collection('subscription').insertOne({
      _id: id,
      email: 'test-atv-doc-id',
      elastic_query: 'test-query',
      query: '/search?q=test',
      site_id: 'rekry',
      hash: 'test-hash',
      status: new Int32(SubscriptionStatus.INACTIVE),
      expiry_notification_sent: new Int32(0),
      created: now,
      modified: now,
      sms_code: '123456',
      sms_code_created: now,
      ...data,
    });
    return id;
  };

  describe('confirmSubscription', () => {
    test('confirms subscription with sms_confirmed: false and clears SMS fields', async () => {
      const id = await insertSubscription({ sms_confirmed: false });
      const collection = mongo.db().collection('subscription');

      const result = await confirmSubscription(collection, id);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.statusCode, 200);

      const doc = await collection.findOne({ _id: id });
      assert.ok(doc);
      assert.strictEqual(doc.status, SubscriptionStatus.ACTIVE);
      assert.strictEqual(doc.sms_confirmed, true);
      assert.strictEqual(doc.sms_code, undefined);
      assert.strictEqual(doc.sms_code_created, undefined);
    });

    test('returns 404 when subscription is already confirmed', async () => {
      const collection = mongo.db().collection('subscription');

      // Already confirmed (sms_confirmed: true)
      const confirmedId = await insertSubscription({
        status: new Int32(SubscriptionStatus.ACTIVE),
        sms_confirmed: true,
      });
      const result1 = await confirmSubscription(collection, confirmedId);
      assert.strictEqual(result1.success, false);
      assert.strictEqual(result1.statusCode, 404);

      // Non-existent
      const result2 = await confirmSubscription(collection, new ObjectId());
      assert.strictEqual(result2.success, false);
      assert.strictEqual(result2.statusCode, 404);
    });

    test('confirming SMS does not set email_confirmed', async () => {
      const id = await insertSubscription({ sms_confirmed: false, email_confirmed: false });
      const collection = mongo.db().collection('subscription');

      const result = await confirmSubscription(collection, id);

      assert.strictEqual(result.success, true);

      const doc = await collection.findOne({ _id: id });
      assert.ok(doc);
      assert.strictEqual(doc.sms_confirmed, true);
      assert.strictEqual(doc.email_confirmed, false, 'email_confirmed should remain false');
    });
  });

  describe('deleteSubscription', () => {
    test('deletes existing subscription', async () => {
      const id = await insertSubscription();
      const collection = mongo.db().collection('subscription');

      const result = await deleteSubscription(collection, id);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.statusCode, 200);
      assert.strictEqual(await collection.findOne({ _id: id }), null);
    });

    test('returns 404 for non-existent subscription', async () => {
      const collection = mongo.db().collection('subscription');
      const result = await deleteSubscription(collection, new ObjectId());

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.statusCode, 404);
    });
  });

  describe('renewSubscription', () => {
    const siteConfig = {
      subscription: { maxAge: 90, expiryNotificationDays: 3 },
    } as SiteConfigurationType;

    const noOpAtvFn: AtvUpdateFn = async () => ({}) as any;

    test('rejects non-ACTIVE or not-yet-renewable subscriptions', async () => {
      const collection = mongo.db().collection('subscription');

      // Non-ACTIVE subscription
      const inactiveId = await insertSubscription();
      const inactiveSub = {
        _id: inactiveId,
        email: 'test-atv-doc-id',
        site_id: 'rekry',
        status: SubscriptionStatus.INACTIVE,
        created: new Date(),
      };
      const result1 = await renewSubscription(collection, inactiveSub, siteConfig, noOpAtvFn);
      assert.strictEqual(result1.success, false);
      assert.strictEqual(result1.statusCode, 400);

      // ACTIVE but outside renewal window (just created)
      const activeId = await insertSubscription({ status: new Int32(SubscriptionStatus.ACTIVE) });
      const activeSub = {
        _id: activeId,
        email: 'test-atv-doc-id',
        site_id: 'rekry',
        status: SubscriptionStatus.ACTIVE,
        created: new Date(),
      };
      const result2 = await renewSubscription(collection, activeSub, siteConfig, noOpAtvFn);
      assert.strictEqual(result2.success, false);
      assert.strictEqual(result2.statusCode, 400);
    });

    test('returns 500 when ATV update fails during renewal', async () => {
      const created = new Date(Date.now() - 88 * 24 * 60 * 60 * 1000);
      const id = await insertSubscription({ status: new Int32(SubscriptionStatus.ACTIVE), created });
      const collection = mongo.db().collection('subscription');

      const failingAtvFn: AtvUpdateFn = async () => {
        throw new Error('ATV unavailable');
      };

      const subscription = {
        _id: id,
        email: 'test-atv-doc-id',
        site_id: 'rekry',
        status: SubscriptionStatus.ACTIVE,
        created,
      };

      const result = await renewSubscription(collection, subscription, siteConfig, failingAtvFn);
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.statusCode, 500);
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
      const collection = mongo.db().collection('subscription');

      const subscription = {
        _id: id,
        email: 'test-atv-doc-id',
        site_id: 'rekry',
        status: SubscriptionStatus.ACTIVE,
        created,
      };

      const result = await renewSubscription(collection, subscription, siteConfig, noOpAtvFn);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.statusCode, 200);
      assert.ok(result.expiryDate);

      const doc = await collection.findOne({ _id: id });
      assert.ok(doc);

      // Created date should be refreshed
      assert.ok(Date.now() - new Date(doc.created).getTime() < 60 * 1000);
      // Expiry notification reset
      assert.strictEqual(doc.expiry_notification_sent, SubscriptionStatus.INACTIVE);
      // delete_after and first_created set
      assert.ok(doc.delete_after);
      assert.ok(doc.first_created);
      assert.strictEqual(new Date(doc.first_created).getTime(), created.getTime());
      // SMS fields cleared
      assert.strictEqual(doc.sms_code, undefined);
      assert.strictEqual(doc.sms_code_created, undefined);
    });
  });
});
