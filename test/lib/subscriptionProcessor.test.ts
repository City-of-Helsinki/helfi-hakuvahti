import * as assert from 'node:assert';
import { after, before, beforeEach, describe, mock, test } from 'node:test';
import { MongoClient } from 'mongodb';
import type { ATV } from '../../src/lib/atv';
import {type ProcessingStats, SubscriptionProcessor} from '../../src/lib/subscriptionProcessor';
import {
  base64,
  createSiteConfig,
  createSubscription,
  emptyElasticResponse,
} from './utils';

const createStats = (): ProcessingStats => ({
  sitesProcessed: 0,
  subscriptionsChecked: 0,
  expiryEmailsQueued: 0,
  newResultsEmailsQueued: 0,
  smsQueued: 0,
});

describe('SubscriptionProcessor', () => {
  assert.ok(process.env.MONGODB, 'MONGODB env var must be set');
  const mongoClient = new MongoClient(process.env.MONGODB);

  const queryElasticProxy = mock.fn<(url: string, json: string) => Promise<any>>();
  const atvGetDocument = mock.fn<ATV['getDocument']>();
  const atvUpdateDocumentDeleteAfter = mock.fn<ATV['updateDocumentDeleteAfter']>();
  const buildProcessor = () =>
    new SubscriptionProcessor({
      mongo: { db: mongoClient.db() } as any,
      atv: {
        getDocument: atvGetDocument,
        updateDocumentDeleteAfter: atvUpdateDocumentDeleteAfter,
      } as any,
      queryElasticProxy,
    });

  before(async () => {
    await mongoClient.connect();
  });

  after(async () => {
    await mongoClient.close();
  });

  beforeEach(async () => {
    queryElasticProxy.mock.restore();
    queryElasticProxy.mock.resetCalls();
    atvGetDocument.mock.restore();
    atvGetDocument.mock.resetCalls();
    atvUpdateDocumentDeleteAfter.mock.restore();
    atvUpdateDocumentDeleteAfter.mock.resetCalls();
    const db = mongoClient.db();
    await db.collection('subscription').deleteMany({});
    await db.collection('queue').deleteMany({});
  });

  test('skips subscriptions not matching site_id', async () => {
    const db = mongoClient.db();
    await db.collection('subscription').insertOne(createSubscription({ site_id: 'other-site' }));

    queryElasticProxy.mock.mockImplementation(async () => emptyElasticResponse());

    const stats = createStats();
    await buildProcessor().processSiteSubscriptions(createSiteConfig(), stats, false);

    assert.strictEqual(stats.subscriptionsChecked, 0);
    assert.strictEqual(queryElasticProxy.mock.callCount(), 0);
  });

  test('no new hits produces no queue items', async () => {
    const db = mongoClient.db();
    await db.collection('subscription').insertOne(createSubscription());

    queryElasticProxy.mock.mockImplementation(async () => emptyElasticResponse());

    const stats = createStats();
    await buildProcessor().processSiteSubscriptions(createSiteConfig(), stats, false);

    assert.strictEqual(stats.subscriptionsChecked, 1);
    const queueItems = await db.collection('queue').find().toArray();
    assert.strictEqual(queueItems.length, 0);
  });

  test('new hits queues email and updates last_checked', async () => {
    const db = mongoClient.db();
    const lastChecked = Math.floor(Date.now() / 1000) - 3600;
    const sub = createSubscription({ last_checked: lastChecked });
    await db.collection('subscription').insertOne(sub);

    const hitTimestamp = Math.floor(Date.now() / 1000);
    queryElasticProxy.mock.mockImplementation(async () => ({
      took: 1,
      hits: {
        total: { value: 1 },
        hits: [{ _source: { publication_starts: [hitTimestamp], address: ['Test St'], valid_from: [hitTimestamp], valid_to: [hitTimestamp] } }],
      },
      responses: [],
    }));

    const stats = createStats();
    await buildProcessor().processSiteSubscriptions(createSiteConfig(), stats, false);

    assert.strictEqual(stats.newResultsEmailsQueued, 1);

    const queueItems = await db.collection('queue').find().toArray();
    assert.strictEqual(queueItems.length, 1);
    assert.strictEqual(queueItems[0].type, 'email');

    const updated = await db.collection('subscription').findOne({ _id: sub._id });
    assert.ok(updated!.last_checked > lastChecked, 'last_checked should be updated');
  });

  test('new hits queues SMS when sms is enabled', async () => {
    const db = mongoClient.db();
    const lastChecked = Math.floor(Date.now() / 1000) - 3600;
    const sub = createSubscription({
      last_checked: lastChecked,
      sms_confirmed: true,
      email_confirmed: false,
    });
    await db.collection('subscription').insertOne(sub);

    const hitTimestamp = Math.floor(Date.now() / 1000);
    queryElasticProxy.mock.mockImplementation(async () => ({
      took: 1,
      hits: {
        total: { value: 1 },
        hits: [{ _source: { publication_starts: [hitTimestamp], address: ['Test St'], valid_from: [hitTimestamp], valid_to: [hitTimestamp] } }],
      },
      responses: [],
    }));

    const siteConfig = createSiteConfig({
      subscription: { maxAge: 90, unconfirmedMaxAge: 7, expiryNotificationDays: 14, enableSms: true },
    });

    const stats = createStats();
    await buildProcessor().processSiteSubscriptions(siteConfig, stats, false);

    assert.strictEqual(stats.smsQueued, 1);

    const queueItems = await db.collection('queue').find().toArray();
    const smsItem = queueItems.find((item) => item.type === 'sms');
    assert.ok(smsItem, 'An SMS queue item should exist');
  });

  test('queues expiry email for subscription nearing expiry', async () => {
    const db = mongoClient.db();
    const createdDate = new Date();
    createdDate.setDate(createdDate.getDate() - 80);
    const sub = createSubscription({
      created: createdDate,
      expiry_notification_sent: 0,
      delete_after: new Date(createdDate.getTime() + 90 * 24 * 60 * 60 * 1000),
    });
    await db.collection('subscription').insertOne(sub);

    queryElasticProxy.mock.mockImplementation(async () => emptyElasticResponse());

    const stats = createStats();
    await buildProcessor().processSiteSubscriptions(createSiteConfig(), stats, false);

    assert.strictEqual(stats.expiryEmailsQueued, 1);

    const updated = await db.collection('subscription').findOne({ _id: sub._id });
    assert.strictEqual(updated!.expiry_notification_sent, 1);

    const queueItems = await db.collection('queue').find().toArray();
    const expiryItem = queueItems.find((item) => item.type === 'email');
    assert.ok(expiryItem, 'An expiry email should be queued');
  });

  test('queues renewal SMS for subscription nearing expiry with SMS enabled', async () => {
    const db = mongoClient.db();
    const createdDate = new Date();
    createdDate.setDate(createdDate.getDate() - 80);
    const sub = createSubscription({
      created: createdDate,
      expiry_notification_sent: 0,
      sms_confirmed: true,
      email_confirmed: false,
      delete_after: new Date(createdDate.getTime() + 90 * 24 * 60 * 60 * 1000),
    });
    await db.collection('subscription').insertOne(sub);

    queryElasticProxy.mock.mockImplementation(async () => emptyElasticResponse());

    const siteConfig = createSiteConfig({
      subscription: { maxAge: 90, unconfirmedMaxAge: 7, expiryNotificationDays: 14, enableSms: true },
    });

    const stats = createStats();
    await buildProcessor().processSiteSubscriptions(siteConfig, stats, false);

    assert.strictEqual(stats.smsQueued, 1);
  });

  test('resolves user data from ATV when user_data_in_atv is set', async () => {
    const db = mongoClient.db();
    const sub = createSubscription({
      user_data_in_atv: 1,
      query: '',
      search_description: '',
      elastic_query: '', // cleared since data is in ATV
    });
    await db.collection('subscription').insertOne(sub);

    const atvElasticQuery = base64(JSON.stringify({ query: { match_all: {} } }));
    atvGetDocument.mock.mockImplementation(async () => ({
      query: '/search?q=from-atv',
      search_description: 'ATV search',
      elastic_query: atvElasticQuery,
    }));

    queryElasticProxy.mock.mockImplementation(async () => emptyElasticResponse());

    const stats = createStats();
    await buildProcessor().processSiteSubscriptions(createSiteConfig(), stats, false);

    assert.strictEqual(atvGetDocument.mock.callCount(), 1);
    assert.strictEqual(stats.subscriptionsChecked, 1);
  });

  test('ATV failure skips subscription', async () => {
    const db = mongoClient.db();
    await db.collection('subscription').insertOne(createSubscription({ user_data_in_atv: 1 }));

    atvGetDocument.mock.mockImplementation(async () => {
      throw new Error('ATV unavailable');
    });

    queryElasticProxy.mock.mockImplementation(async () => {
      throw new Error('Should not be called');
    });

    const stats = createStats();
    await buildProcessor().processSiteSubscriptions(createSiteConfig(), stats, false);

    assert.strictEqual(queryElasticProxy.mock.callCount(), 0);
  });

  test('syncs delete_after when missing from subscription', async () => {
    const db = mongoClient.db();
    const sub = createSubscription({ delete_after: undefined });
    await db.collection('subscription').insertOne(sub);

    atvUpdateDocumentDeleteAfter.mock.mockImplementation(async () => ({}));
    queryElasticProxy.mock.mockImplementation(async () => emptyElasticResponse());

    const stats = createStats();
    await buildProcessor().processSiteSubscriptions(createSiteConfig(), stats, false);

    assert.strictEqual(atvUpdateDocumentDeleteAfter.mock.callCount(), 1);

    const updated = await db.collection('subscription').findOne({ _id: sub._id });
    assert.ok(updated!.delete_after, 'delete_after should be set in DB');
  });
});
