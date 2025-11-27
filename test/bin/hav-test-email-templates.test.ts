import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { generateTestEmails } from '../../src/bin/hav-test-email-templates';

test('generateTestEmails queues all email types for all languages', async () => {
  const queuedEmails: Array<{ email: string; content: string }> = [];
  const mockQueueCollection = {
    insertOne: async (doc: { email: string; content: string }) => {
      queuedEmails.push(doc);
      return { insertedId: 'mock-id' };
    },
  };

  const mockSiteConfig = {
    id: 'rekry',
    name: 'Rekry',
    urls: {
      base: 'https://test.hel.fi',
      fi: 'https://test.hel.fi/fi',
      en: 'https://test.hel.fi/en',
      sv: 'https://test.hel.fi/sv',
    },
    mail: {
      templatePath: 'rekry',
    },
    translations: {
      site_name: { fi: 'Avoimet työpaikat', en: 'Open positions', sv: 'Lediga jobb' },
    },
  };

  const testEmail = 'test@mailpit';

  await generateTestEmails(mockQueueCollection, testEmail, mockSiteConfig);

  assert.equal(queuedEmails.length, 9, 'Should queue 9 emails');
  assert.ok(queuedEmails.every((email) => email.email === testEmail), 'All emails should use test email address');
  assert.ok(queuedEmails.every((email) => email.content.length > 0), 'All emails should have content');
});
