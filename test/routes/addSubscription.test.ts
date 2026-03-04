import * as assert from 'node:assert';
import { before, describe, mock, test } from 'node:test';
import { ObjectId } from '@fastify/mongodb';
import axios from 'axios';
import { SubscriptionStatus } from '../../src/types/subscription';
import { build } from '../helper';

const validPayload = {
  email: 'test@example.com',
  elastic_query: Buffer.from('{"query":{"match_all":{}}}').toString('base64'),
  query: '/search?q=test',
  site_id: 'rekry',
  lang: 'fi',
};

describe('/subscription', () => {
  // Set up axios mocks for tests that need external API calls
  before(() => {
    // ATV class uses axios.request
    mock.method(axios, 'request', async (config: { url?: string }) => {
      const url = config.url ?? '';
      if (url.includes('/v1/documents/')) {
        return {
          data: {
            id: 'mock-atv-document-id',
            draft: 'false',
            tos_function_id: 'test',
            tos_record_id: 'test',
          },
        };
      }
      throw new Error(`Unexpected axios.request URL: ${url}`);
    });

    // Elastic proxy uses axios.post
    mock.method(axios, 'post', async (url: string) => {
      if (url.includes('_search')) {
        return { data: { hits: { hits: [] } } };
      }
      throw new Error(`Unexpected axios.post URL: ${url}`);
    });
  });

  test('rejects invalid input', async (t) => {
    const app = await build(t);

    const testCases = [
      {
        name: 'invalid email format',
        payload: { ...validPayload, email: 'invalid-email' },
        expectedError: 'Invalid email format',
      },
      {
        name: 'invalid SMS format',
        payload: { ...validPayload, sms: 'not-a-number' },
        expectedError: 'Invalid phone number format',
      },
      {
        name: 'invalid site_id',
        payload: { ...validPayload, site_id: 'nonexistent-site' },
        expectedError: 'Invalid site_id',
      },
      {
        name: 'missing email',
        payload: { ...validPayload, email: undefined },
      },
      {
        name: 'missing elastic_query',
        payload: { ...validPayload, elastic_query: undefined },
      },
      {
        name: 'missing site_id',
        payload: { ...validPayload, site_id: undefined },
      },
    ];

    for (const { name, payload, expectedError } of testCases) {
      await t.test(name, async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/subscription',
          headers: { Authorization: 'api-key test' },
          payload,
        });

        assert.strictEqual(res.statusCode, 400);

        if (expectedError) {
          const body = JSON.parse(res.body);
          assert.ok(body.error.includes(expectedError), `error should include "${expectedError}"`);
        }
      });
    }
  });

  test('accepts valid subscriptions', async (t) => {
    const app = await build(t);

    const testCases = [
      {
        name: 'email only',
        payload: validPayload,
      },
      {
        name: 'swedish language',
        payload: { ...validPayload, lang: 'sv' },
      },
      {
        name: 'email and SMS',
        payload: { ...validPayload, sms: '+358451234567' },
      },
      {
        name: 'with search_description',
        payload: { ...validPayload, search_description: 'My saved search' },
      },
      {
        name: 'with user_data_in_atv',
        payload: {
          ...validPayload,
          user_data_in_atv: 1,
        },
      },
      {
        name: 'with user_data_in_atv and search_description',
        payload: {
          ...validPayload,
          user_data_in_atv: 1,
          search_description: 'My saved search',
        },
      },
    ];

    for (const { name, payload } of testCases as {
      name: string;
      payload: typeof validPayload & { user_data_in_atv?: number; search_description?: string };
    }[]) {
      await t.test(name, async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/subscription',
          headers: { Authorization: 'api-key test' },
          payload,
        });

        const body = JSON.parse(res.body);

        assert.strictEqual(res.statusCode, 200, `${name}: should return 200`);
        assert.strictEqual(body.acknowledged, true, `${name}: should be acknowledged`);
        assert.ok(body.insertedId, `${name}: should have insertedId`);

        // Verify MongoDB document was inserted.
        const collection = app.mongo.db?.collection('subscription');
        const subscription = await collection?.findOne({ _id: new ObjectId(body.insertedId) });

        assert.ok(subscription, `${name}: subscription should exist in MongoDB`);
        assert.strictEqual(subscription.lang, payload.lang, `${name}: lang should match`);
        assert.strictEqual(subscription.email, 'mock-atv-document-id', `${name}: email should be ATV document ID`);
        assert.strictEqual(subscription.atv_id, 'mock-atv-document-id', `${name}: atv_id should be ATV document ID`);
        assert.strictEqual(subscription.status, SubscriptionStatus.INACTIVE);
        assert.strictEqual(subscription.site_id, payload.site_id);
        assert.strictEqual(subscription.lang, payload.lang);

        if (payload.user_data_in_atv) {
          assert.strictEqual(subscription.elastic_query, '', `${name}: elastic_query should be empty`);
          assert.strictEqual(subscription.query, '', `${name}: query should be empty`);
          assert.strictEqual(subscription.search_description, '', `${name}: search_description should be empty`);
          assert.strictEqual(subscription.user_data_in_atv, 1, `${name}: user_data_in_atv should be 1`);
        } else {
          assert.strictEqual(subscription.elastic_query, payload.elastic_query, `${name}: elastic_query should match`);
          assert.strictEqual(subscription.query, payload.query, `${name}: query should match`);
        }

        // Verify delete_after is set correctly (created + maxAge days)
        assert.ok(subscription.delete_after, `${name}: delete_after should be set`);
        assert.ok(
          subscription.delete_after.getTime() > subscription.created.getTime(),
          `${name}: delete_after should be after created date`,
        );
      });
    }
  });
});

describe('/subscription plugin failures', () => {
  test('handles ATV failure', async (t) => {
    // Mock ATV to fail
    mock.method(axios, 'request', async (config: { url?: string }) => {
      const url = config.url ?? '';
      if (url.includes('/v1/documents/')) {
        throw new Error('ATV service unavailable');
      }
      throw new Error(`Unexpected axios.request URL: ${url}`);
    });
    mock.method(axios, 'post', async (url: string) => {
      if (url.includes('_search')) {
        return { data: { hits: { hits: [] } } };
      }
      throw new Error(`Unexpected axios.post URL: ${url}`);
    });

    const app = await build(t);

    const res = await app.inject({
      method: 'POST',
      url: '/subscription',
      headers: { Authorization: 'api-key test' },
      payload: validPayload,
    });

    assert.strictEqual(res.statusCode, 500);
    const body = JSON.parse(res.body);
    assert.ok(body.error);
  });

  test('handles Elasticsearch validation failure', async (t) => {
    // Mock ATV to succeed
    mock.method(axios, 'request', async (config: { url?: string }) => {
      const url = config.url ?? '';
      if (url.includes('/v1/documents/')) {
        return {
          data: {
            id: 'mock-atv-document-id',
            draft: 'false',
            tos_function_id: 'test',
            tos_record_id: 'test',
          },
        };
      }
      throw new Error(`Unexpected axios.request URL: ${url}`);
    });
    // Mock Elasticsearch to fail
    mock.method(axios, 'post', async (url: string) => {
      if (url.includes('_search')) {
        throw new Error('Elasticsearch query failed');
      }
      throw new Error(`Unexpected axios.post URL: ${url}`);
    });

    const app = await build(t);

    const res = await app.inject({
      method: 'POST',
      url: '/subscription',
      headers: { Authorization: 'api-key test' },
      payload: validPayload,
    });

    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.ok(body.error.includes('elastic_query'));
  });
});
