import * as assert from 'node:assert';
import { afterEach, describe, mock, test } from 'node:test';
import { ATV } from '../../src/lib/atv.ts';

const defaultConfig = {
  apiUrl: 'https://atv.example.com',
  apiKey: 'test-api-key',
  defaultMaxAge: 90,
};

// biome-ignore lint/suspicious/noExplicitAny: test helper returns loosely-typed fetch args
function getCall(mockFetch: ReturnType<typeof mock.method>, index = 0): { url: string; opts: any } {
  const args = mockFetch.mock.calls[index]!.arguments;
  return { url: args[0], opts: args[1] };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('ATV', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  describe('getAtvId', () => {
    test('prefers atv_id over email', () => {
      assert.strictEqual(ATV.getAtvId({ atv_id: 'atv-123', email: 'legacy-email' }), 'atv-123');
    });

    test('falls back to email when atv_id is missing', () => {
      assert.strictEqual(ATV.getAtvId({ email: 'legacy-email' }), 'legacy-email');
    });

    test('falls back to email when atv_id is empty', () => {
      assert.strictEqual(ATV.getAtvId({ atv_id: '', email: 'legacy-email' }), 'legacy-email');
    });
  });

  describe('createDocument', () => {
    test('sends POST with multipart form data and correct structure', async () => {
      const mockFetch = mock.method(globalThis, 'fetch', async () => jsonResponse({ id: 'new-doc-id', draft: 'false' }));

      const atv = new ATV(defaultConfig);
      const content = { email: 'test@example.com' };
      const result = await atv.createDocument(content, 'func-123');

      assert.strictEqual(mockFetch.mock.callCount(), 1);
      const { url, opts } = getCall(mockFetch);
      assert.strictEqual(opts.method, 'post');
      assert.strictEqual(url, `${defaultConfig.apiUrl}/v1/documents/`);
      assert.strictEqual(opts.headers['X-Api-Key'], defaultConfig.apiKey);
      // multipart bodies must not set Content-Type explicitly (fetch adds the boundary)
      assert.strictEqual(opts.headers['Content-Type'], undefined);
      assert.ok(opts.body instanceof FormData);
      assert.strictEqual(opts.body.get('draft'), 'false');
      assert.strictEqual(opts.body.get('tos_function_id'), 'func-123');
      assert.strictEqual(opts.body.get('content'), JSON.stringify(content));
      assert.deepStrictEqual(result, { id: 'new-doc-id', draft: 'false' });
    });

    test('sets tos_record_id and delete_after from current time', async () => {
      const fixedTime = new Date('2024-06-15T12:00:00Z').getTime();
      mock.timers.enable({ apis: ['Date'], now: fixedTime });

      const mockFetch = mock.method(globalThis, 'fetch', async () => jsonResponse({}));

      const atv = new ATV({ ...defaultConfig, defaultMaxAge: 30 });
      await atv.createDocument({ email: 'test@example.com' }, 'func-123');

      mock.timers.reset();

      const { opts } = getCall(mockFetch);
      assert.strictEqual(opts.body.get('tos_record_id'), Math.floor(fixedTime / 1000).toString());

      const expected = new Date(fixedTime);
      expected.setDate(expected.getDate() + 30);
      assert.strictEqual(opts.body.get('delete_after'), expected.toISOString().substring(0, 10));
    });

    test('wraps network errors with cause', async () => {
      const originalError = new Error('network error');
      mock.method(globalThis, 'fetch', async () => {
        throw originalError;
      });

      const atv = new ATV(defaultConfig);
      await assert.rejects(
        () => atv.createDocument({ email: 'test@example.com' }, 'func-123'),
        (err: Error) => {
          assert.strictEqual(err.message, 'ATV request failed');
          assert.strictEqual(err.cause, originalError);
          return true;
        },
      );
    });
  });

  describe('getDocument', () => {
    test('sends GET and returns document content', async () => {
      const content = { email: 'user@example.com', sms: '+358401234567' };
      const mockFetch = mock.method(globalThis, 'fetch', async () => jsonResponse({ id: 'doc-123', content }));

      const atv = new ATV(defaultConfig);
      const result = await atv.getDocument('doc-123');

      assert.deepStrictEqual(result, content);
      assert.strictEqual(mockFetch.mock.callCount(), 1);
      const { url, opts } = getCall(mockFetch);
      assert.strictEqual(opts.method, 'get');
      assert.strictEqual(url, `${defaultConfig.apiUrl}/v1/documents/doc-123`);
      assert.strictEqual(opts.headers['X-Api-Key'], defaultConfig.apiKey);
      assert.strictEqual(opts.headers['Content-Type'], undefined);
      assert.strictEqual(opts.body, undefined);
    });

    test('throws when content is missing', async () => {
      mock.method(globalThis, 'fetch', async () => jsonResponse({ id: 'doc-123' }));

      const atv = new ATV(defaultConfig);
      await assert.rejects(() => atv.getDocument('doc-123'), { message: 'Empty content returned from API' });
    });

    test('throws when content is falsy', async () => {
      mock.method(globalThis, 'fetch', async () => jsonResponse({ id: 'doc-123', content: null }));

      const atv = new ATV(defaultConfig);
      await assert.rejects(() => atv.getDocument('doc-123'), { message: 'Empty content returned from API' });
    });

    test('wraps network errors with cause', async () => {
      const originalError = new Error('timeout');
      mock.method(globalThis, 'fetch', async () => {
        throw originalError;
      });

      const atv = new ATV(defaultConfig);
      await assert.rejects(
        () => atv.getDocument('doc-123'),
        (err: Error) => {
          assert.strictEqual(err.message, 'ATV request failed');
          assert.strictEqual(err.cause, originalError);
          return true;
        },
      );
    });
  });

  describe('updateDocumentDeleteAfter', () => {
    const existingDoc = {
      tos_function_id: 'func-1',
      tos_record_id: 'rec-1',
      content: { email: 'user@example.com' },
      draft: 'false',
    };

    test('fetches document then patches with new delete_after', async () => {
      const patchedDoc = { ...existingDoc, delete_after: '2024-03-31' };
      let callCount = 0;
      const mockFetch = mock.method(globalThis, 'fetch', async () => {
        callCount++;
        if (callCount === 1) return jsonResponse(existingDoc);
        return jsonResponse(patchedDoc);
      });

      const atv = new ATV(defaultConfig);
      const result = await atv.updateDocumentDeleteAfter('doc-123', new Date(2024, 2, 31));

      assert.strictEqual(mockFetch.mock.callCount(), 2);

      const getCallArgs = getCall(mockFetch, 0);
      assert.strictEqual(getCallArgs.opts.method, 'get');
      assert.strictEqual(getCallArgs.url, `${defaultConfig.apiUrl}/v1/documents/doc-123`);

      const patchCallArgs = getCall(mockFetch, 1);
      assert.strictEqual(patchCallArgs.opts.method, 'patch');
      assert.strictEqual(patchCallArgs.url, `${defaultConfig.apiUrl}/v1/documents/doc-123`);
      assert.strictEqual(patchCallArgs.opts.headers['Content-Type'], 'application/json');
      assert.strictEqual(JSON.parse(patchCallArgs.opts.body).delete_after, '2024-03-31');

      assert.deepStrictEqual(result, patchedDoc);
    });

    test('sets delete_after to the provided date', async () => {
      let callCount = 0;
      const mockFetch = mock.method(globalThis, 'fetch', async () => {
        callCount++;
        if (callCount === 1) return jsonResponse(existingDoc);
        return jsonResponse({});
      });

      const atv = new ATV(defaultConfig);
      await atv.updateDocumentDeleteAfter('doc-123', new Date(2024, 2, 1));

      const patchCallArgs = getCall(mockFetch, 1);
      assert.strictEqual(JSON.parse(patchCallArgs.opts.body).delete_after, '2024-03-01');
    });

    test('wraps errors with cause', async () => {
      const originalError = new Error('server error');
      mock.method(globalThis, 'fetch', async () => {
        throw originalError;
      });

      const atv = new ATV(defaultConfig);
      await assert.rejects(
        () => atv.updateDocumentDeleteAfter('doc-123', new Date()),
        (err: Error) => {
          assert.strictEqual(err.message, 'ATV request failed');
          assert.strictEqual(err.cause, originalError);
          return true;
        },
      );
    });
  });

  describe('getDocumentBatch', () => {
    test('sends POST to batch-list endpoint', async () => {
      const docs = [{ id: 'doc-1' }, { id: 'doc-2' }];
      const mockFetch = mock.method(globalThis, 'fetch', async () => jsonResponse(docs));

      const atv = new ATV(defaultConfig);
      const result = await atv.getDocumentBatch(['doc-1', 'doc-2']);

      assert.deepStrictEqual(result, docs);
      assert.strictEqual(mockFetch.mock.callCount(), 1);
      const { url, opts } = getCall(mockFetch);
      assert.strictEqual(opts.method, 'post');
      assert.strictEqual(url, `${defaultConfig.apiUrl}/v1/documents/batch-list/`);
      assert.strictEqual(opts.headers['Content-Type'], 'application/json');
      assert.deepStrictEqual(JSON.parse(opts.body), { document_ids: ['doc-1', 'doc-2'] });
    });

    test('wraps errors with cause', async () => {
      const originalError = new Error('batch failed');
      mock.method(globalThis, 'fetch', async () => {
        throw originalError;
      });

      const atv = new ATV(defaultConfig);
      await assert.rejects(
        () => atv.getDocumentBatch(['doc-1']),
        (err: Error) => {
          assert.strictEqual(err.message, 'ATV request failed');
          assert.strictEqual(err.cause, originalError);
          return true;
        },
      );
    });
  });
});
