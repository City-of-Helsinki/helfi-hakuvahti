import * as assert from 'node:assert';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ObjectId } from '@fastify/mongodb';
import { Int32, MongoClient } from 'mongodb';
import type { ATV } from '../../src/lib/atv.ts';
import { Statistics } from '../../src/lib/statistics.ts';
import {
  ActionError,
  confirmSubscription,
  deleteSubscription,
  renewSubscription,
} from '../../src/lib/subscriptionActions.ts';
import type { StatisticsCollectionType } from '../../src/types/statistics.ts';
import { type SubscriptionCollectionType, SubscriptionStatus } from '../../src/types/subscription.ts';

describe('subscriptionActions', () => {
  assert.ok(process.env.MONGODB);
  const mongo = new MongoClient(process.env.MONGODB);
  const statistics = new Statistics({ db: mongo.db() });

  before(async () => {
    await mongo.connect();
  });

  after(async () => {
    await mongo.close();
  });

  beforeEach(async () => {
    await mongo.db().collection<SubscriptionCollectionType>('subscription').deleteMany({});
    await mongo.db().collection('statistics').deleteMany({ site_id: 'rekry' });
  });

  /** Today's counters for the site the fixtures use. */
  const counters = async (): Promise<StatisticsCollectionType | null> =>
    (await mongo
      .db()
      .collection('statistics')
      .findOne({ _id: `rekry:${Statistics.day()}` })) as StatisticsCollectionType | null;

  // Helper to insert a subscription (matching MongoDB JSON Schema validation)
  const insertSubscription = async (data: Record<string, unknown> = {}) => {
    const id = new ObjectId();
    const now = new Date();
    await mongo
      .db()
      .collection<SubscriptionCollectionType>('subscription')
      .insertOne({
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
        sms_secret: 'test-secret',
        ...data,
      } as SubscriptionCollectionType);
    return id;
  };

  describe('confirmSubscription', () => {
    test('confirms SMS subscription with sms_confirmed: false', async () => {
      const beforeConfirm = new Date();
      const id = await insertSubscription({ sms_confirmed: false });
      const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

      await confirmSubscription(collection, { _id: id }, 'sms', statistics);

      const doc = await collection.findOne({ _id: id });
      assert.ok(doc);
      assert.strictEqual(doc.status, SubscriptionStatus.ACTIVE);
      assert.strictEqual(doc.sms_confirmed, true);
      assert.ok(doc.modified >= beforeConfirm, 'modified should be updated');
    });

    test('confirms email subscription without touching SMS fields', async () => {
      const id = await insertSubscription({ email_confirmed: false, sms_confirmed: false });
      const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

      await confirmSubscription(collection, { _id: id }, 'email', statistics);

      const doc = await collection.findOne({ _id: id });
      assert.ok(doc);
      assert.strictEqual(doc.status, SubscriptionStatus.ACTIVE);
      assert.strictEqual(doc.email_confirmed, true);
      assert.strictEqual(doc.sms_confirmed, false, 'sms_confirmed should remain false');
    });

    test('throws 404 when subscription is already confirmed', async () => {
      const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

      // Already confirmed (sms_confirmed: true)
      const confirmedId = await insertSubscription({
        status: new Int32(SubscriptionStatus.ACTIVE),
        sms_confirmed: true,
      });
      await assert.rejects(
        () => confirmSubscription(collection, { _id: confirmedId }, 'sms', statistics),
        (error: ActionError) => {
          assert.strictEqual(error.statusCode, 404);
          return true;
        },
      );

      // Non-existent
      await assert.rejects(
        () => confirmSubscription(collection, { _id: new ObjectId() }, 'sms', statistics),
        (error: ActionError) => {
          assert.strictEqual(error.statusCode, 404);
          return true;
        },
      );
    });

    test('confirming SMS does not set email_confirmed', async () => {
      const id = await insertSubscription({ sms_confirmed: false, email_confirmed: false });
      const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

      await confirmSubscription(collection, { _id: id }, 'sms', statistics);

      const doc = await collection.findOne({ _id: id });
      assert.ok(doc);
      assert.strictEqual(doc.sms_confirmed, true);
      assert.strictEqual(doc.email_confirmed, false, 'email_confirmed should remain false');
    });

    test('counts a confirmation once per subscription, not once per channel', async () => {
      const id = await insertSubscription({ email_confirmed: false, sms_confirmed: false, lang: 'sv' });
      const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

      // One subscriber, two channels, one activation.
      await confirmSubscription(collection, { _id: id }, 'email', statistics);
      await confirmSubscription(collection, { _id: id }, 'sms', statistics);

      const stats = await counters();
      assert.strictEqual(stats?.events?.confirmed, 1);
      assert.strictEqual(stats?.lang?.sv?.confirmed, 1);
    });

    test('records nothing when the confirmation 404s', async () => {
      const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

      await assert.rejects(() => confirmSubscription(collection, { _id: new ObjectId() }, 'sms', statistics));

      assert.strictEqual(await counters(), null);
    });
  });

  describe('deleteSubscription', () => {
    test('deletes existing subscription', async () => {
      const id = await insertSubscription();
      const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

      await deleteSubscription(collection, { _id: id }, statistics);

      assert.strictEqual(await collection.findOne({ _id: id }), null);
    });

    test('throws 404 for non-existent subscription', async () => {
      const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

      await assert.rejects(
        () => deleteSubscription(collection, { _id: new ObjectId() }, statistics),
        (error: ActionError) => {
          assert.strictEqual(error.statusCode, 404);
          return true;
        },
      );

      assert.strictEqual(await counters(), null);
    });

    test('separates a cancelled live subscription from an abandoned signup', async () => {
      const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

      const activeId = await insertSubscription({ status: new Int32(SubscriptionStatus.ACTIVE) });
      const unconfirmedId = await insertSubscription({ lang: 'en' });

      await deleteSubscription(collection, { _id: activeId }, statistics);
      await deleteSubscription(collection, { _id: unconfirmedId }, statistics);

      const stats = await counters();
      assert.strictEqual(stats?.events?.cancelled, 1);
      assert.strictEqual(stats?.events?.cancelled_unconfirmed, 1);

      // The language keys partition the totals exactly.
      assert.strictEqual(stats?.lang?.fi?.cancelled, 1);
      assert.strictEqual(stats?.lang?.en?.cancelled_unconfirmed, 1);
      assert.strictEqual(stats?.lang?.fi?.cancelled_unconfirmed, undefined);
    });
  });

  describe('renewSubscription', () => {
    const noOpAtv = { updateDocumentDeleteAfter: async () => ({}) } as unknown as ATV;

    test('throws 400 for non-ACTIVE subscriptions', async () => {
      const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

      const inactiveId = await insertSubscription();
      await assert.rejects(
        () => renewSubscription(collection, { _id: inactiveId }, noOpAtv),
        (error: ActionError) => {
          assert.strictEqual(error.statusCode, 400);
          return true;
        },
      );
    });

    test('throws 500 when ATV update fails during renewal', async () => {
      const created = new Date(Date.now() - 88 * 24 * 60 * 60 * 1000);
      const id = await insertSubscription({ status: new Int32(SubscriptionStatus.ACTIVE), created });
      const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

      const failingAtv = {
        updateDocumentDeleteAfter: async () => {
          throw new Error('ATV unavailable');
        },
      } as unknown as ATV;

      await assert.rejects(
        () => renewSubscription(collection, { _id: id }, failingAtv),
        (error: ActionError) => {
          assert.strictEqual(error.statusCode, 500);
          return true;
        },
      );
    });

    test('successfully renews and updates all fields', async () => {
      const created = new Date(Date.now() - 88 * 24 * 60 * 60 * 1000);
      const id = await insertSubscription({
        status: new Int32(SubscriptionStatus.ACTIVE),
        created,
        expiry_notification_sent: new Int32(1),
      });
      const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

      await renewSubscription(collection, { _id: id }, noOpAtv);

      const doc = await collection.findOne({ _id: id });
      assert.ok(doc);

      // created should be reset so expiration checks (created + maxAge) restart from now
      assert.ok(Date.now() - new Date(doc.created).getTime() < 60 * 1000, 'created should be reset on renewal');
      // Modified date should be refreshed
      assert.ok(Date.now() - new Date(doc.modified).getTime() < 60 * 1000);
      // Expiry notification reset
      assert.strictEqual(doc.expiry_notification_sent, SubscriptionStatus.INACTIVE);
      // delete_after set
      assert.ok(doc.delete_after);
    });
  });
});
