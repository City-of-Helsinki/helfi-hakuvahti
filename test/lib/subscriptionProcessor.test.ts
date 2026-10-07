import * as assert from 'node:assert';
import { after, before, beforeEach, describe, mock, test } from 'node:test';
import { type Db, MongoClient, MongoServerError } from 'mongodb';
import type { ATV } from '../../src/lib/atv.ts';
import { type ProcessingStats, SubscriptionProcessor } from '../../src/lib/subscriptionProcessor.ts';
import { base64, captureSentryEvents, createSiteConfig, createSubscription, emptyElasticResponse } from './utils.ts';

const createStats = (): ProcessingStats => ({
  sitesProcessed: 0,
  subscriptionsChecked: 0,
  expiryEmailsQueued: 0,
  newResultsEmailsQueued: 0,
  smsQueued: 0,
});

/** What Cosmos DB answers when the request unit budget is used up. */
const TOO_MANY_REQUESTS = 'Error=16500, RetryAfterMs=292, TooManyRequests (429)';

/**
 * A Db whose `method` on one collection fails the way Cosmos DB throttles,
 * on the given call numbers.
 */
const throttled = (db: Db, collectionName: string, method: 'insertOne' | 'updateOne', failOnCalls: number[]): Db => {
  let calls = 0;

  return new Proxy(db, {
    get(target, prop) {
      if (prop !== 'collection') {
        return Reflect.get(target, prop);
      }

      return (name: string) => {
        const collection = target.collection(name);
        if (name !== collectionName) {
          return collection;
        }

        return new Proxy(collection, {
          get(innerTarget, innerProp) {
            if (innerProp !== method) {
              return Reflect.get(innerTarget, innerProp);
            }

            return async (...args: unknown[]) => {
              calls++;
              if (failOnCalls.includes(calls)) {
                throw new MongoServerError({ code: 16500, errmsg: TOO_MANY_REQUESTS });
              }

              return (innerTarget as any)[method](...args);
            };
          },
        });
      };
    },
  });
};

const oneNewHit = (now = Math.floor(Date.now() / 1000)) => {
  return {
    took: 1,
    hits: {
      total: { value: 1 },
      hits: [{ _source: { publication_starts: [now], address: ['Test St'], valid_from: [now], valid_to: [now] } }],
    },
    responses: [],
  };
};

/** Rekry has the email templates but not the new results and renewal SMS ones. */
const siteWithoutSmsTemplates = () =>
  createSiteConfig({
    mail: { templatePath: 'rekry', maxHitsInEmail: 10 },
    subscription: { maxAge: 90, unconfirmedMaxAge: 7, expiryNotificationDays: 14, enableSms: true },
  });

describe('SubscriptionProcessor', () => {
  assert.ok(process.env.MONGODB, 'MONGODB env var must be set');
  const mongoClient = new MongoClient(process.env.MONGODB);

  const queryElasticProxy = mock.fn<(url: string, json: string) => Promise<any>>();
  const atvGetDocument = mock.fn<ATV['getDocument']>();
  const atvUpdateDocumentDeleteAfter = mock.fn<ATV['updateDocumentDeleteAfter']>();
  const sentry = captureSentryEvents();
  const buildProcessor = (db: Db = mongoClient.db()) =>
    new SubscriptionProcessor({
      mongo: { db } as any,
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
    await db.collection('statistics').deleteMany({ site_id: 'test-site' });
    await sentry.take();
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
        hits: [
          {
            _source: {
              publication_starts: [hitTimestamp],
              address: ['Test St'],
              valid_from: [hitTimestamp],
              valid_to: [hitTimestamp],
            },
          },
        ],
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
        hits: [
          {
            _source: {
              publication_starts: [hitTimestamp],
              address: ['Test St'],
              valid_from: [hitTimestamp],
              valid_to: [hitTimestamp],
            },
          },
        ],
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

  test('keeps last_checked when queueing the new results email fails, and reports it', async () => {
    const db = mongoClient.db();
    const lastChecked = Math.floor(Date.now() / 1000) - 3600;
    const sub = createSubscription({ last_checked: lastChecked });
    await db.collection('subscription').insertOne(sub);
    queryElasticProxy.mock.mockImplementation(async () => oneNewHit());

    await buildProcessor(throttled(db, 'queue', 'insertOne', [1])).processSiteSubscriptions(
      createSiteConfig(),
      createStats(),
      false,
    );

    assert.strictEqual(await db.collection('queue').countDocuments(), 0);
    const afterFailure = await db.collection('subscription').findOne({ _id: sub._id });
    assert.strictEqual(afterFailure?.last_checked, lastChecked, 'Hits that were not queued are not skipped');
    assert.deepStrictEqual(await sentry.take(), [`MongoServerError: ${TOO_MANY_REQUESTS}`]);

    // The next run queues the same hits.
    await buildProcessor().processSiteSubscriptions(createSiteConfig(), createStats(), false);

    assert.strictEqual(await db.collection('queue').countDocuments(), 1);
  });

  test('leaves the expiry notification unsent when queueing it fails, and reports it', async () => {
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

    await buildProcessor(throttled(db, 'queue', 'insertOne', [1])).processSiteSubscriptions(
      createSiteConfig(),
      createStats(),
      false,
    );

    assert.strictEqual(await db.collection('queue').countDocuments(), 0);
    const afterFailure = await db.collection('subscription').findOne({ _id: sub._id });
    assert.strictEqual(
      afterFailure?.expiry_notification_sent,
      0,
      'A notification that was not queued is not marked sent',
    );
    assert.deepStrictEqual(await sentry.take(), [`MongoServerError: ${TOO_MANY_REQUESTS}`]);

    // The next run queues it.
    await buildProcessor().processSiteSubscriptions(createSiteConfig(), createStats(), false);

    assert.strictEqual(await db.collection('queue').countDocuments(), 1);
    const afterRetry = await db.collection('subscription').findOne({ _id: sub._id });
    assert.strictEqual(afterRetry?.expiry_notification_sent, 1);
  });

  test('goes on with the next subscription when updating last_checked fails', async () => {
    const db = mongoClient.db();
    const lastChecked = Math.floor(Date.now() / 1000) - 3600;
    const subs = [1, 2, 3].map(() => createSubscription({ last_checked: lastChecked }));
    await db.collection('subscription').insertMany(subs);
    queryElasticProxy.mock.mockImplementation(async () => oneNewHit());

    await buildProcessor(throttled(db, 'subscription', 'updateOne', [2])).processSiteSubscriptions(
      createSiteConfig(),
      createStats(),
      false,
    );

    assert.strictEqual(await db.collection('queue').countDocuments(), 3, 'Every subscription is processed');
    const second = await db.collection('subscription').findOne({ _id: subs[1]._id });
    assert.strictEqual(second?.last_checked, lastChecked);
    assert.deepStrictEqual(await sentry.take(), [`MongoServerError: ${TOO_MANY_REQUESTS}`]);
  });

  test('goes on with the next subscription when one fails unexpectedly', async () => {
    const db = mongoClient.db();
    // No lang, like the legacy rows the expiry sweep has to handle.
    const { lang: _lang, ...broken } = createSubscription();
    const sub = createSubscription();
    await db.collection('subscription').insertMany([broken, sub]);
    queryElasticProxy.mock.mockImplementation(async () => oneNewHit());

    await buildProcessor().processSiteSubscriptions(createSiteConfig(), createStats(), false);

    const queueItems = await db.collection('queue').find().toArray();
    assert.strictEqual(queueItems.length, 1, 'The subscription after the broken one is processed');
    const reported = await sentry.take();
    assert.strictEqual(reported.length, 1);
    assert.match(reported[0], /^TypeError: /);
  });

  test('a new results message that cannot be built is reported, not retried', async () => {
    const db = mongoClient.db();
    const lastChecked = Math.floor(Date.now() / 1000) - 3600;
    const sub = createSubscription({ last_checked: lastChecked, sms_confirmed: true });
    await db.collection('subscription').insertOne(sub);
    const hit = oneNewHit(Math.floor(Date.now() / 1000) - 60);
    queryElasticProxy.mock.mockImplementation(async () => hit);

    for (const _run of [1, 2]) {
      await buildProcessor().processSiteSubscriptions(siteWithoutSmsTemplates(), createStats(), false);
    }

    const queueItems = await db.collection('queue').find().toArray();
    assert.deepStrictEqual(
      queueItems.map((item) => item.type),
      ['email'],
      'The email is queued once, not again on every run',
    );
    const updated = await db.collection('subscription').findOne({ _id: sub._id });
    assert.ok(updated!.last_checked > lastChecked, 'last_checked moves forward');
    const reported = await sentry.take();
    assert.strictEqual(reported.length, 1);
    assert.match(reported[0], /sms\/newhits\.txt/);
  });

  test('an expiry message that cannot be built is reported, not retried', async () => {
    const db = mongoClient.db();
    const createdDate = new Date();
    createdDate.setDate(createdDate.getDate() - 80);
    const sub = createSubscription({
      created: createdDate,
      expiry_notification_sent: 0,
      sms_confirmed: true,
      delete_after: new Date(createdDate.getTime() + 90 * 24 * 60 * 60 * 1000),
    });
    await db.collection('subscription').insertOne(sub);
    queryElasticProxy.mock.mockImplementation(async () => emptyElasticResponse());

    for (const _run of [1, 2]) {
      await buildProcessor().processSiteSubscriptions(siteWithoutSmsTemplates(), createStats(), false);
    }

    const queueItems = await db.collection('queue').find().toArray();
    assert.deepStrictEqual(
      queueItems.map((item) => item.type),
      ['email'],
      'The expiry email is queued once, not again on every run',
    );
    const updated = await db.collection('subscription').findOne({ _id: sub._id });
    assert.strictEqual(updated?.expiry_notification_sent, 1);
    const reported = await sentry.take();
    assert.strictEqual(reported.length, 1);
    assert.match(reported[0], /sms\/renew\.txt/);
  });
});
