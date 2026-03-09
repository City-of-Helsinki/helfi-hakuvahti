import * as fs from 'node:fs';
import { JSDOM } from 'jsdom';
import command from '../lib/command';
import { confirmationEmail, confirmationSms, expiryEmail, newHitsEmail, newHitsSms, renewalSms } from '../lib/email';
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader';
import mailer from '../plugins/mailer';
import type { FastifyMailer } from '../types/mailer';
import type { SiteConfigurationType } from '../types/siteConfig';
import type { SubscriptionCollectionLanguageType } from '../types/subscription';

// npm run hav:test-all-templates -- --email=test@test.fi
//
// Renders ALL email and SMS templates for every configured site
// and sends them directly via SMTP (Mailpit) for visual inspection.
// SMS templates are wrapped in a minimal HTML body for readability.
// No ATV, no queue, no subscriptions needed

const LANGUAGES: SubscriptionCollectionLanguageType[] = ['fi', 'en', 'sv'];
const TEMPLATE_BASE = 'dist/templates';

const templateExists = (siteConfig: SiteConfigurationType, relativePath: string): boolean =>
  fs.existsSync(`${TEMPLATE_BASE}/${siteConfig.mail.templatePath}/${relativePath}`);

const SITE_DUMMY_HITS: Record<string, Record<string, unknown>[]> = {
  rekry: [
    {
      url: ['/fi/avoimet-tyopaikat/it-asiantuntija'],
      title: 'IT-asiantuntija, Kaupunkiympäristön toimiala',
      field_publication_starts: [Math.floor(Date.now() / 1000)],
    },
    {
      url: ['/fi/avoimet-tyopaikat/ohjelmistokehittaja'],
      title: 'Ohjelmistokehittäjä',
      field_publication_starts: [Math.floor(Date.now() / 1000)],
    },
  ],
  kymp: [
    {
      address: ['Mannerheimintie 1'],
      valid_from: [Math.floor(Date.now() / 1000)],
      valid_to: [Math.floor(Date.now() / 1000) + 86400 * 30],
      created_at: [Math.floor(Date.now() / 1000)],
    },
    {
      address: ['Aleksanterinkatu 52'],
      valid_from: [Math.floor(Date.now() / 1000) - 86400 * 7],
      valid_to: [Math.floor(Date.now() / 1000) + 86400 * 60],
      created_at: [Math.floor(Date.now() / 1000)],
    },
  ],
};

const buildTestData = (siteConfig: SiteConfigurationType) => {
  const base = siteConfig.urls.base;
  return {
    confirmation: {
      link: `${base}/hakuvahti/confirm/abc123`,
      search_description: 'Testihaku',
    },
    expiry: {
      link: `${base}/hakuvahti/search`,
      search_description: 'IT-asiantuntija',
      removal_date: '31.12.2025',
      remove_link: `${base}/hakuvahti/unsubscribe?subscription=abc123&hash=xyz`,
      renewal_link: `${base}/hakuvahti/renew?subscription=abc123&hash=xyz`,
      search_link: '/fi/search-results',
    },
    newhits: {
      search_description: 'IT-asiantuntija',
      search_link: '/fi/search-results',
      remove_link: `${base}/hakuvahti/unsubscribe?subscription=abc123&hash=xyz`,
      created_date: '15.11.2025',
      expiry_date: '15.05.2026',
    },
    sms: {
      id: '123',
      sms_code: '123456',
      search_description: 'Testihaku',
      expiry_date: '15.05.2026',
    },
  };
};

// Wrap plain text SMS content in minimal HTML for Mailpit readability.
const wrapSmsAsHtml = (smsText: string, label: string): string =>
  `<!DOCTYPE html><html><head><title>SMS: ${label}</title></head><body>` +
  `<h2>SMS: ${label}</h2>` +
  `<pre style="font-family:monospace;font-size:16px;white-space:pre-wrap;max-width:600px;padding:20px;background:#f5f5f5;border:1px solid #ccc;">${smsText}</pre>` +
  '</body></html>';

// Extract <title> from rendered HTML for the email subject line.
const extractTitle = (html: string): string => {
  const dom = new JSDOM(html);
  return dom.window.document.querySelector('title')?.textContent || 'Template test';
};

// Send a rendered template directly via SMTP.
const sendTemplate = (emailSender: FastifyMailer, to: string, html: string): Promise<void> =>
  new Promise((resolve, reject) => {
    emailSender.sendMail(
      {
        to,
        subject: extractTitle(html),
        html,
      },
      (errors, info) => {
        if (errors) return reject(errors);
        return resolve(info);
      },
    );
  });

async function renderAndSendSiteTemplates(
  emailSender: FastifyMailer,
  testEmail: string,
  siteId: string,
  siteConfig: SiteConfigurationType,
): Promise<number> {
  let count = 0;
  const hits = SITE_DUMMY_HITS[siteId] ?? SITE_DUMMY_HITS.rekry;
  const testData = buildTestData(siteConfig);

  for (const lang of LANGUAGES) {
    // 1. Confirmation email
    const confirmHtml = await confirmationEmail(lang, testData.confirmation, siteConfig);
    await sendTemplate(emailSender, testEmail, confirmHtml);
    count++;

    // 2. Expiry email
    const expiryHtml = await expiryEmail(lang, testData.expiry, siteConfig);
    await sendTemplate(emailSender, testEmail, expiryHtml);
    count++;

    // 3. New hits email (with site-specific dummy hits)
    const newhitsHtml = await newHitsEmail(lang, { ...testData.newhits, hits }, siteConfig);
    await sendTemplate(emailSender, testEmail, newhitsHtml);
    count++;

    // 4. SMS templates (rendered as email for Mailpit viewing)
    if (templateExists(siteConfig, 'sms/confirmation.txt')) {
      const confirmSms = await confirmationSms(lang, { sms_code: testData.sms.sms_code, id: '123' }, siteConfig);
      await sendTemplate(emailSender, testEmail, wrapSmsAsHtml(confirmSms, `${siteId} / ${lang} / confirmation`));
      count++;
    }

    if (templateExists(siteConfig, 'sms/newhits.txt')) {
      const newhitsSmsText = await newHitsSms(lang, { hits, ...testData.sms, id: '123' }, siteConfig);
      await sendTemplate(emailSender, testEmail, wrapSmsAsHtml(newhitsSmsText, `${siteId} / ${lang} / newhits`));
      count++;
    }

    if (templateExists(siteConfig, 'sms/renew.txt')) {
      const renewSmsText = await renewalSms(lang, testData.sms, siteConfig);
      await sendTemplate(emailSender, testEmail, wrapSmsAsHtml(renewSmsText, `${siteId} / ${lang} / renewal`));
      count++;
    }
  }

  return count;
}

command(
  async (server, argv) => {
    const testEmail = argv.email as string | undefined;

    if (!testEmail) {
      throw new Error('--email parameter required. Example: npm run hav:test-all-templates -- --email=test@test.fi');
    }

    const siteIds = SiteConfigurationLoader.getSiteIds();

    let totalSent = 0;

    for (const siteId of siteIds) {
      const siteConfig = SiteConfigurationLoader.getConfiguration(siteId);
      if (!siteConfig) {
        console.warn(`Skipping ${siteId}: configuration not found`);
        continue;
      }

      console.log(
        `Rendering templates for: ${siteId} (SMS templates: ${siteConfig.subscription.enableSms ? 'yes' : 'no'})`,
      );
      const count = await renderAndSendSiteTemplates(server.mailer, testEmail, siteId, siteConfig);
      totalSent += count;
      console.log(`  Sent ${count} emails for ${siteId}`);
    }

    console.log(`\nDone! Sent ${totalSent} emails to ${testEmail}.`);
    console.log('Check Mailpit at: https://mailpit.docker.so/');
  },
  [mailer],
);
