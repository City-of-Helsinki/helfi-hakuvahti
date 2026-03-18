import { Buffer } from 'node:buffer';
import { ObjectId } from '@fastify/mongodb';
import type { SiteConfigurationType } from '../../src/types/siteConfig';
import { SubscriptionStatus } from '../../src/types/subscription';

export const base64 = (str: string) => Buffer.from(str).toString('base64');

/** Minimal translations required by the kymp templates. */
const translations: SiteConfigurationType['translations'] = {
  copyright_holder: { fi: 'Test', en: 'Test', sv: 'Test' },
  email_logo: { fi: 'logo.png', en: 'logo.png', sv: 'logo.png' },
  email_subject_expiry: { fi: 'Expiry', en: 'Expiry', sv: 'Expiry' },
  email_subject_newhits: { fi: 'New', en: 'New', sv: 'New' },
  email_expiry_title_header: { fi: '', en: '', sv: '' },
  email_expiry_prefix: { fi: '', en: '', sv: '' },
  email_expiry_suffix: { fi: '', en: '', sv: '' },
  email_expiry_renewal_button: { fi: '', en: '', sv: '' },
  email_expiry_new_link: { fi: '', en: '', sv: '' },
  email_generic_your_search_terms: { fi: '', en: '', sv: '' },
  email_generic_remove_link: { fi: '', en: '', sv: '' },
  email_generic_automatically_sent: { fi: '', en: '', sv: '' },
  email_newhits_header: { fi: '', en: '', sv: '' },
  email_newhits_intro_prefix: { fi: '', en: '', sv: '' },
  email_newhits_link_text: { fi: '', en: '', sv: '' },
  email_newhits_expiry_prefix: { fi: '', en: '', sv: '' },
  email_newhits_expiry_suffix: { fi: '', en: '', sv: '' },
  email_newhits_expiry_instructions: { fi: '', en: '', sv: '' },
  sms_newhits_intro: { fi: '', en: '', sv: '' },
  sms_newhits_remove_text: { fi: '', en: '', sv: '' },
  sms_newhits_remove_link: { fi: '', en: '', sv: '' },
  sms_renewal_intro: { fi: '', en: '', sv: '' },
  sms_renewal_search_label: { fi: '', en: '', sv: '' },
  sms_renewal_text: { fi: '', en: '', sv: '' },
  sms_renewal_link: { fi: '', en: '', sv: '' },
};

export const createSiteConfig = (overrides?: Partial<SiteConfigurationType>): SiteConfigurationType => ({
  id: 'test-site',
  name: 'Test Site',
  urls: {
    base: 'https://example.com',
    en: 'https://example.com/en',
    fi: 'https://example.com/fi',
    sv: 'https://example.com/sv',
  },
  subscription: { maxAge: 90, unconfirmedMaxAge: 7, expiryNotificationDays: 14, enableSms: false },
  mail: { templatePath: 'kymp', maxHitsInEmail: 10 },
  elasticProxyUrl: 'https://elastic.example.com',
  matchField: 'publication_starts',
  translations,
  ...overrides,
});

const recentDate = () => {
  const d = new Date();
  d.setDate(d.getDate() - 5); // 5 days ago.
  return d;
};

export const createSubscription = (overrides?: Record<string, unknown>) => ({
  _id: new ObjectId(),
  atv_id: 'atv-doc-1',
  email: '',
  query: '/search?q=test',
  search_description: 'test search',
  elastic_query: base64(JSON.stringify({ query: { match_all: {} } })),
  hash: 'abc123',
  site_id: 'test-site',
  created: recentDate(),
  modified: recentDate(),
  delete_after: new Date(Date.now() + 85 * 24 * 60 * 60 * 1000),
  lang: 'fi' as const,
  last_checked: Math.floor(recentDate().getTime() / 1000),
  expiry_notification_sent: 0,
  status: SubscriptionStatus.ACTIVE,
  email_confirmed: true,
  sms_confirmed: false,
  sms_secret: '',
  ...overrides,
});

export const emptyElasticResponse = () => ({
  took: 1,
  hits: { total: { value: 0 }, hits: [] },
  responses: [],
});
