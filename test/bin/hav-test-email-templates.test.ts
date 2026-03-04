import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Collection } from 'mongodb';
import { generateTestEmails } from '../../src/bin/hav-test-email-templates';
import type { QueueInsertDocument } from '../../src/types/queue';

test('generateTestEmails queues all email types for all languages', async () => {
  const queuedEmails: Array<QueueInsertDocument> = [];
  const mockQueueCollection = {
    insertOne: async (doc: QueueInsertDocument) => {
      queuedEmails.push(doc);
      return { insertedId: 'mock-id' };
    },
  } as unknown as Collection<QueueInsertDocument>;

  const mockSiteConfig = {
    id: 'rekry',
    name: 'Rekry',
    urls: {
      base: 'https://test.hel.fi',
      fi: 'https://test.hel.fi/fi',
      en: 'https://test.hel.fi/en',
      sv: 'https://test.hel.fi/sv',
    },
    subscription: {
      maxAge: 90,
      unconfirmedMaxAge: 5,
      expiryNotificationDays: 5,
    },
    mail: {
      templatePath: 'rekry',
    },
    elasticProxyUrl: 'https://elastic.test',
    matchField: 'field_publication_starts',
    translations: {
      site_name: { fi: 'Avoimet työpaikat', en: 'Open positions', sv: 'Lediga jobb' },
    },
  } as const;

  const testEmail = 'test@mailpit';

  await generateTestEmails(mockQueueCollection, testEmail, mockSiteConfig);

  assert.equal(queuedEmails.length, 9, 'Should queue 9 emails');
  assert.ok(queuedEmails.every((email) => email.atv_id === testEmail), 'All emails should use test email address');
  assert.ok(queuedEmails.every((email) => email.content.length > 0), 'All emails should have content');
  assert.ok(queuedEmails.every((email) => email.type === 'email'), 'All items should have type email');
});
