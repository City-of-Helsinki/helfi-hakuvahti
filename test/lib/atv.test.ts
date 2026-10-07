import * as assert from 'node:assert';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, mock, test } from 'node:test';
import { ATV } from '../../src/lib/atv.ts';

const defaultConfig = {
  apiUrl: 'https://atv.example.com',
  apiKey: 'test-api-key',
};

const deleteAfter = new Date('2024-09-13T12:00:00Z');

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

  describe('isDocumentId', () => {
    test('accepts a UUID in either case', () => {
      assert.strictEqual(ATV.isDocumentId('2aff1ec8-ca48-4356-acb1-805d9f180a06'), true);
      assert.strictEqual(ATV.isDocumentId('2AFF1EC8-CA48-4356-ACB1-805D9F180A06'), true);
    });

    test('rejects anything ATV would reject in a batch lookup', () => {
      for (const value of [
        '',
        'atv-a',
        'someone@example.com',
        '2aff1ec8ca484356acb1805d9f180a06',
        undefined,
        null,
        123,
      ]) {
        assert.strictEqual(ATV.isDocumentId(value), false, `${String(value)} is not a document id`);
      }
    });
  });

  describe('createDocument', () => {
    test('sends POST with multipart form data and correct structure', async () => {
      const mockFetch = mock.method(globalThis, 'fetch', async () =>
        jsonResponse({ id: 'new-doc-id', draft: 'false' }),
      );

      const atv = new ATV(defaultConfig);
      const content = { email: 'test@example.com' };
      const result = await atv.createDocument(content, 'func-123', deleteAfter);

      assert.strictEqual(mockFetch.mock.callCount(), 1);
      const { url, opts } = getCall(mockFetch);
      assert.strictEqual(opts.method, 'POST');
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

    test('sets tos_record_id from current time and delete_after from the given date', async () => {
      const fixedTime = new Date('2024-06-15T12:00:00Z').getTime();
      mock.timers.enable({ apis: ['Date'], now: fixedTime });

      const mockFetch = mock.method(globalThis, 'fetch', async () => jsonResponse({}));

      const atv = new ATV(defaultConfig);
      await atv.createDocument({ email: 'test@example.com' }, 'func-123', deleteAfter);

      mock.timers.reset();

      const { opts } = getCall(mockFetch);
      assert.strictEqual(opts.body.get('tos_record_id'), Math.floor(fixedTime / 1000).toString());
      assert.strictEqual(opts.body.get('delete_after'), '2024-09-13');
    });

    test('wraps network errors with cause', async () => {
      const originalError = new Error('network error');
      mock.method(globalThis, 'fetch', async () => {
        throw originalError;
      });

      const atv = new ATV(defaultConfig);
      await assert.rejects(
        () => atv.createDocument({ email: 'test@example.com' }, 'func-123', deleteAfter),
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
      assert.strictEqual(opts.method, 'GET');
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
      assert.strictEqual(getCallArgs.opts.method, 'GET');
      assert.strictEqual(getCallArgs.url, `${defaultConfig.apiUrl}/v1/documents/doc-123`);

      const patchCallArgs = getCall(mockFetch, 1);
      assert.strictEqual(patchCallArgs.opts.method, 'PATCH');
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

    test('sends a PATCH that a real HTTP server accepts', async () => {
      // The fetch mocks above cannot see what fetch() puts on the wire. A real
      // server rejects a lowercase `patch` with 400, as the ATV gateway does.
      const methods: string[] = [];
      const server = createServer((req, res) => {
        methods.push(req.method ?? '');
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(existingDoc));
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const atv = new ATV({ ...defaultConfig, apiUrl: `http://127.0.0.1:${port}` });
        await atv.updateDocumentDeleteAfter('doc-123', new Date(2024, 2, 1));
      } finally {
        server.close();
        server.closeAllConnections();
      }

      assert.deepStrictEqual(methods, ['GET', 'PATCH']);
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
      assert.strictEqual(opts.method, 'POST');
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
