import * as assert from 'node:assert';
import { after, before, beforeEach, describe, mock, test } from 'node:test';
import { MongoClient } from 'mongodb';
import type { ATV } from '../../src/lib/atv.ts';
import { BroadcastService } from '../../src/lib/broadcastService.ts';
import { SubscriptionStatus } from '../../src/types/subscription.ts';
import { createSiteConfig, createSubscription } from './utils.ts';

const messages = {
  fi: { subject: 'Huoltokatko', body: 'FI body' },
  sv: { subject: 'Underhåll', body: 'SV body' },
  en: { subject: 'Maintenance', body: 'EN body' },
};

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

describe('BroadcastService', () => {
  assert.ok(process.env.MONGODB, 'MONGODB env var must be set');
  const mongoClient = new MongoClient(process.env.MONGODB);

  // ATV documents by id; getDocumentBatch resolves from this map.
  let atvDocs: Record<string, { email?: string; sms?: string }>;
  const atvGetDocumentBatch = mock.fn<ATV['getDocumentBatch']>();
  const buildService = (batchSize?: number) =>
    new BroadcastService({
      db: mongoClient.db(),
      atv: { getDocumentBatch: atvGetDocumentBatch } as any,
      batchSize,
    });

  before(async () => {
    await mongoClient.connect();
  });

  after(async () => {
    await mongoClient.close();
  });

  beforeEach(async () => {
    atvDocs = {};
    atvGetDocumentBatch.mock.restore();
    atvGetDocumentBatch.mock.resetCalls();
    atvGetDocumentBatch.mock.mockImplementation(
      async (ids: string[]) => ids.filter((id) => atvDocs[id]).map((id) => ({ id, content: atvDocs[id] })) as any,
    );
    const db = mongoClient.db();
    await db.collection('subscription').deleteMany({});
    await db.collection('queue').deleteMany({});
  });

  test('queues one localized email per subscriber', async () => {
    const db = mongoClient.db();
    atvDocs = { 'atv-1': { email: 'a@example.com' }, 'atv-2': { email: 'b@example.com' } };
    await db
      .collection('subscription')
      .insertMany([
        createSubscription({ atv_id: 'atv-1', lang: 'fi' }),
        createSubscription({ atv_id: 'atv-2', lang: 'en' }),
      ]);

    const stats = await buildService().broadcast(createSiteConfig(), messages);

    assert.strictEqual(stats.subscriptionsChecked, 2);
    assert.strictEqual(stats.emailsQueued, 2);
    assert.strictEqual(stats.smsQueued, 0);
    assert.strictEqual(stats.missingContacts, 0);

    const queueItems = await db.collection('queue').find().toArray();
    assert.strictEqual(queueItems.length, 2);
    const fiItem = queueItems.find((item) => item.atv_id === 'atv-1');
    const enItem = queueItems.find((item) => item.atv_id === 'atv-2');
    assert.ok(fiItem?.content.includes('Huoltokatko'));
    assert.ok(fiItem?.content.includes('FI body'));
    assert.ok(fiItem?.content.includes('<title>Huoltokatko</title>'));
    assert.ok(enItem?.content.includes('Maintenance'));
  });

  test('deduplicates subscriptions sharing an email address', async () => {
    const db = mongoClient.db();
    atvDocs = { 'atv-1': { email: 'Same@example.com' }, 'atv-2': { email: 'same@example.com' } };
    await db
      .collection('subscription')
      .insertMany([createSubscription({ atv_id: 'atv-1' }), createSubscription({ atv_id: 'atv-2' })]);

    const stats = await buildService().broadcast(createSiteConfig(), messages);

    assert.strictEqual(stats.subscriptionsChecked, 2);
    assert.strictEqual(stats.emailsQueued, 1);
    assert.strictEqual(await db.collection('queue').countDocuments(), 1);
  });

  test('most recently renewed subscription decides the language', async () => {
    const db = mongoClient.db();
    atvDocs = { 'atv-old': { email: 'same@example.com' }, 'atv-new': { email: 'same@example.com' } };
    await db
      .collection('subscription')
      .insertMany([
        createSubscription({ atv_id: 'atv-old', lang: 'fi', created: daysAgo(10) }),
        createSubscription({ atv_id: 'atv-new', lang: 'en', created: daysAgo(1) }),
      ]);

    await buildService().broadcast(createSiteConfig(), messages);

    const queueItems = await db.collection('queue').find().toArray();
    assert.strictEqual(queueItems.length, 1);
    assert.strictEqual(queueItems[0].atv_id, 'atv-new');
    assert.ok(queueItems[0].content.includes('Maintenance'));
  });

  test('queues both email and SMS for a subscriber with both channels', async () => {
    const db = mongoClient.db();
    atvDocs = { 'atv-1': { email: 'a@example.com', sms: '+358401234567' } };
    await db
      .collection('subscription')
      .insertOne(createSubscription({ atv_id: 'atv-1', email_confirmed: true, sms_confirmed: true }));

    const siteConfig = createSiteConfig({
      subscription: { maxAge: 90, unconfirmedMaxAge: 7, expiryNotificationDays: 14, enableSms: true },
    });
    const stats = await buildService().broadcast(siteConfig, messages);

    assert.strictEqual(stats.emailsQueued, 1);
    assert.strictEqual(stats.smsQueued, 1);

    const queueItems = await db.collection('queue').find().toArray();
    assert.strictEqual(queueItems.length, 2);
    const smsItem = queueItems.find((item) => item.type === 'sms');
    assert.strictEqual(smsItem?.content.trim(), 'Huoltokatko\n\nFI body');
  });

  test('deduplicates subscriptions sharing a phone number', async () => {
    const db = mongoClient.db();
    atvDocs = { 'atv-1': { sms: '+358401234567' }, 'atv-2': { sms: '+358401234567' } };
    await db
      .collection('subscription')
      .insertMany([
        createSubscription({ atv_id: 'atv-1', email_confirmed: false, sms_confirmed: true }),
        createSubscription({ atv_id: 'atv-2', email_confirmed: false, sms_confirmed: true }),
      ]);

    const siteConfig = createSiteConfig({
      subscription: { maxAge: 90, unconfirmedMaxAge: 7, expiryNotificationDays: 14, enableSms: true },
    });
    const stats = await buildService().broadcast(siteConfig, messages);

    assert.strictEqual(stats.smsQueued, 1);
    assert.strictEqual(await db.collection('queue').countDocuments(), 1);
  });

  test('sends no SMS when the site has SMS disabled', async () => {
    const db = mongoClient.db();
    atvDocs = { 'atv-1': { email: 'a@example.com', sms: '+358401234567' } };
    await db
      .collection('subscription')
      .insertOne(createSubscription({ atv_id: 'atv-1', email_confirmed: true, sms_confirmed: true }));

    const stats = await buildService().broadcast(createSiteConfig(), messages);
    assert.strictEqual(stats.smsQueued, 0);
    assert.strictEqual(stats.emailsQueued, 1);
  });

  test('respects channel confirmation flags including the legacy fallback', async () => {
    const db = mongoClient.db();
    atvDocs = {
      'atv-declined': { email: 'declined@example.com' },
      'atv-legacy': { email: 'legacy@example.com' },
    };
    const legacy = createSubscription({ atv_id: 'atv-legacy' });
    delete (legacy as Record<string, unknown>).email_confirmed;
    delete (legacy as Record<string, unknown>).sms_confirmed;
    await db
      .collection('subscription')
      .insertMany([createSubscription({ atv_id: 'atv-declined', email_confirmed: false }), legacy]);

    const stats = await buildService().broadcast(createSiteConfig(), messages);

    assert.strictEqual(stats.emailsQueued, 1);
    const queueItems = await db.collection('queue').find().toArray();
    assert.strictEqual(queueItems.length, 1);
    assert.strictEqual(queueItems[0].atv_id, 'atv-legacy');
  });

  test('skips inactive subscriptions and other sites', async () => {
    const db = mongoClient.db();
    atvDocs = { 'atv-1': { email: 'a@example.com' }, 'atv-2': { email: 'b@example.com' } };
    await db
      .collection('subscription')
      .insertMany([
        createSubscription({ atv_id: 'atv-1', status: SubscriptionStatus.INACTIVE }),
        createSubscription({ atv_id: 'atv-2', site_id: 'other-site' }),
      ]);

    const stats = await buildService().broadcast(createSiteConfig(), messages);

    assert.strictEqual(stats.subscriptionsChecked, 0);
    assert.strictEqual(await db.collection('queue').countDocuments(), 0);
  });

  test('counts subscriptions with missing ATV contact details', async () => {
    const db = mongoClient.db();
    atvDocs = { 'atv-1': { email: 'a@example.com' } };
    await db
      .collection('subscription')
      .insertMany([createSubscription({ atv_id: 'atv-1' }), createSubscription({ atv_id: 'atv-missing' })]);

    const stats = await buildService().broadcast(createSiteConfig(), messages);

    assert.strictEqual(stats.missingContacts, 1);
    assert.strictEqual(stats.emailsQueued, 1);
  });

  test('processes in batches and deduplicates across batch boundaries', async () => {
    const db = mongoClient.db();
    const subscriptions = [];
    for (let i = 0; i < 15; i++) {
      // The two newest subscriptions share an email with the two oldest.
      const email = `user${i % 13}@example.com`;
      atvDocs[`atv-${i}`] = { email };
      subscriptions.push(createSubscription({ atv_id: `atv-${i}`, created: daysAgo(i) }));
    }
    await db.collection('subscription').insertMany(subscriptions);

    const stats = await buildService(10).broadcast(createSiteConfig(), messages);

    assert.strictEqual(atvGetDocumentBatch.mock.callCount(), 2);
    assert.strictEqual(stats.subscriptionsChecked, 15);
    assert.strictEqual(stats.emailsQueued, 13);
    assert.strictEqual(await db.collection('queue').countDocuments(), 13);
  });

  test('test mode targets only the given subscription ids', async () => {
    const db = mongoClient.db();
    atvDocs = { 'atv-1': { email: 'a@example.com' }, 'atv-2': { email: 'b@example.com' } };
    const target = createSubscription({ atv_id: 'atv-1' });
    await db.collection('subscription').insertMany([target, createSubscription({ atv_id: 'atv-2' })]);

    const stats = await buildService().broadcast(createSiteConfig(), messages, [target._id]);

    assert.strictEqual(stats.subscriptionsChecked, 1);
    assert.strictEqual(stats.emailsQueued, 1);
    const queueItems = await db.collection('queue').find().toArray();
    assert.strictEqual(queueItems.length, 1);
    assert.strictEqual(queueItems[0].atv_id, 'atv-1');
  });

  test('escapes HTML in the admin-provided subject and body', async () => {
    const db = mongoClient.db();
    atvDocs = { 'atv-1': { email: 'a@example.com' } };
    await db.collection('subscription').insertOne(createSubscription({ atv_id: 'atv-1' }));

    const evilMessages = {
      fi: { subject: 'Huolto <script>alert(1)</script>', body: 'line1\nline2 <b>bold</b>' },
      sv: { subject: 's', body: 'b' },
      en: { subject: 's', body: 'b' },
    };
    await buildService().broadcast(createSiteConfig(), evilMessages);

    const queueItems = await db.collection('queue').find().toArray();
    assert.strictEqual(queueItems.length, 1);
    assert.ok(!queueItems[0].content.includes('<script>'));
    assert.ok(queueItems[0].content.includes('&lt;script&gt;'));
    assert.ok(queueItems[0].content.includes('line1<br />line2'));
    assert.ok(queueItems[0].content.includes('&lt;b&gt;bold&lt;/b&gt;'));
  });
});
