import { strict as assert } from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { after, before, test } from 'node:test';

import {
  buildSearchLink,
  buildTranslationContext,
  confirmationEmail,
  expiryEmail,
  newHitsEmail,
  newHitsSms,
  translate,
  wrapWithLayout,
} from '../../src/lib/email.ts';
import type { SiteConfigurationType } from '../../src/types/siteConfig.ts';
import type { SubscriptionCollectionLanguageType } from '../../src/types/subscription.ts';

const TEMPLATE_ROOT = path.join('src', 'templates', 'test');
const INNER_TEMPLATE = path.join(TEMPLATE_ROOT, 'inner_fi.html');
const LAYOUT_TEMPLATE = path.join(TEMPLATE_ROOT, 'index.html');

const baseConfig: SiteConfigurationType = {
  id: 'test',
  name: 'test',
  urls: {
    base: 'https://test.test',
    en: 'https://test.test/en',
    fi: 'https://test.test/fi',
    sv: 'https://test.test/sv',
  },
  subscription: {
    maxAge: 90,
    unconfirmedMaxAge: 5,
    expiryNotificationDays: 3,
  },
  mail: {
    templatePath: 'test',
    maxHitsInEmail: 10,
  },
  elasticProxyUrl: 'https://elastic.test',
  matchField: 'field_publication_starts',
  translations: {
    foo: {
      fi: 'Hei',
      en: 'Hello',
      sv: 'Hej',
    },
    empty_value: {
      fi: '',
      en: 'fallback',
      sv: 'placeholder',
    },
  },
};

const SMS_DIR = path.join(TEMPLATE_ROOT, 'sms');
const SMS_NEWHITS_TEMPLATE = path.join(SMS_DIR, 'newhits.txt');
const SMS_HIT_ITEM_TEMPLATE = path.join(SMS_DIR, 'hit_item.txt');

const createTestTemplates = async () => {
  await fs.mkdir(TEMPLATE_ROOT, { recursive: true });
  await fs.mkdir(SMS_DIR, { recursive: true });
  await fs.writeFile(INNER_TEMPLATE, '<div class="inner">{{ foo }}<span>{{ custom_value }}</span></div>', 'utf-8');
  await fs.writeFile(
    LAYOUT_TEMPLATE,
    '<html><body><main>{{ content }}</main><footer>{{ foo }} - {{ title }}</footer></body></html>',
    'utf-8',
  );
  await fs.writeFile(SMS_NEWHITS_TEMPLATE, 'New results for {{ search_description }}: {{ hits }}', 'utf-8');
  await fs.writeFile(SMS_HIT_ITEM_TEMPLATE, '{{ address }} ({{ valid_from }} - {{ valid_to }})\n', 'utf-8');
  await fs.writeFile(
    path.join(TEMPLATE_ROOT, 'confirmation.html'),
    '<p>{{ search_description }}</p><a href="{{ link }}">confirm</a>',
    'utf-8',
  );
  await fs.writeFile(
    path.join(TEMPLATE_ROOT, 'newhits.html'),
    '<p>{{ search_description }}</p>{{ hits }}<a href="{{ search_link }}">results</a>',
    'utf-8',
  );
  await fs.writeFile(
    path.join(TEMPLATE_ROOT, 'hit_item.html'),
    '<li><a href="{{ url }}">{{ title }}</a></li>',
    'utf-8',
  );
  await fs.writeFile(
    path.join(TEMPLATE_ROOT, 'expiry_notification.html'),
    '<p>{{ search_description }}</p><a href="{{ search_link }}">search</a>',
    'utf-8',
  );
};

before(async () => {
  await createTestTemplates();
});

after(async () => {
  await fs.rm(TEMPLATE_ROOT, { recursive: true, force: true });
});

test('buildTranslationContext returns language specific map', () => {
  const ctx = buildTranslationContext('fi', baseConfig);
  assert.equal(ctx.foo, 'Hei');
  assert.equal(ctx.empty_value, '');
  assert.equal(ctx.nonexistent as string | undefined, undefined);
});

test('translate falls back to empty string when key or language missing', () => {
  const missingKey = translate('does_not_exist', 'fi', baseConfig);
  assert.equal(missingKey, '');
  const missingLang = translate('foo', 'sv', {
    ...baseConfig,
    translations: {
      foo: { fi: 'Hei', en: 'Hello', sv: '' },
    },
  });
  assert.equal(missingLang, '');
});

const executeWrap = (lang: SubscriptionCollectionLanguageType, customValue: string) =>
  wrapWithLayout(
    path.join('src', 'templates', baseConfig.mail.templatePath, 'inner_fi.html'),
    { custom_value: customValue },
    lang,
    `Subject for ${lang}`,
    baseConfig,
  );

test('wrapWithLayout injects translations into inner template and layout', () => {
  const html = executeWrap('fi', 'custom');
  assert.match(html, /<div class="inner">Hei<span>custom<\/span><\/div>/);
  assert.match(html, /<footer>Hei - Subject for fi<\/footer>/);
});

test('buildTranslationContext returns correct translations for all languages', () => {
  const languages: SubscriptionCollectionLanguageType[] = ['fi', 'en', 'sv'];

  for (const lang of languages) {
    const ctx = buildTranslationContext(lang, baseConfig);
    assert.equal(ctx.foo, baseConfig.translations!.foo[lang], `Should return correct translation for ${lang}`);
    assert.equal(ctx.empty_value, baseConfig.translations!.empty_value[lang], `Should handle empty values for ${lang}`);
    assert.equal(Object.keys(ctx).length, Object.keys(baseConfig.translations!).length);
  }
});

test('wrapWithLayout includes layout variables and injects content correctly', () => {
  const html = executeWrap('en', 'test-value');

  assert.ok(html.includes('<body>'), 'Should include body tag');
  assert.ok(html.includes('<div class="inner">'), 'Should include inner template structure');
  assert.ok(html.includes(baseConfig.translations!.foo.en), 'Should include correct translation in layout');
});

test('newHitsSms renders hits through hit_item template with field formatters', async () => {
  const configWithFormats: SiteConfigurationType = {
    ...baseConfig,
    fieldFormats: {
      valid_from: 'date',
      valid_to: 'date',
    },
  };

  const hits = [
    {
      address: ['Mannerheimintie 1'],
      valid_from: [1709568000], // 2024-03-04 in epoch seconds
      valid_to: [1712160000], // 2024-04-03 in epoch seconds
    },
    {
      address: ['Aleksanterinkatu 52'],
      valid_from: [1709568000],
      valid_to: [1714752000], // 2024-05-03 in epoch seconds
    },
  ];

  const result = await newHitsSms(
    'fi',
    {
      hits,
      search_description: 'Testihaku',
      id: '123456',
    },
    configWithFormats,
  );

  assert.ok(result.includes('Testihaku'), 'Should include search description');
  assert.ok(result.includes('Mannerheimintie 1'), 'Should include first hit address');
  assert.ok(result.includes('Aleksanterinkatu 52'), 'Should include second hit address');
  assert.match(result, /\d{2}\.\d{2}\.\d{4}/, 'Should include formatted dates');
});

const INJECTED_DESCRIPTION = '</p><h1>Account locked</h1><a href="https://attacker.example">Restore</a><p>';
const ESCAPED_DESCRIPTION =
  '&lt;/p&gt;&lt;h1&gt;Account locked&lt;/h1&gt;&lt;a href=&quot;https://attacker.example&quot;&gt;Restore&lt;/a&gt;&lt;p&gt;';

test('confirmationEmail escapes search_description', async () => {
  const html = await confirmationEmail(
    'fi',
    { link: 'https://test.test/confirm', search_description: INJECTED_DESCRIPTION },
    baseConfig,
  );

  assert.ok(!html.includes('<h1>Account locked</h1>'), 'Raw HTML must not be rendered');
  assert.ok(!html.includes('href="https://attacker.example"'), 'Injected link must not be rendered');
  assert.ok(html.includes(`<p>${ESCAPED_DESCRIPTION.toLowerCase()}</p>`), 'Description must be escaped');
});

test('newHitsEmail escapes search_description and rejects off-site search_link', async () => {
  const html = await newHitsEmail(
    'fi',
    {
      hits: [{ title: ['Job'] }],
      search_description: INJECTED_DESCRIPTION,
      search_link: '@attacker.example/',
      remove_link: 'https://test.test/remove',
      created_date: '1.1.2026',
      expiry_date: '1.4.2026',
    },
    baseConfig,
  );

  assert.ok(html.includes(`<p>${ESCAPED_DESCRIPTION}</p>`), 'Description must be escaped');
  assert.ok(html.includes('<a href="https://test.test/">results</a>'), 'Off-site link must fall back to base url');
  assert.ok(!html.includes('attacker.example/'), 'Attacker host must not appear in the link');
});

test('expiryEmail escapes search_description and keeps a valid search_link', async () => {
  const html = await expiryEmail(
    'fi',
    {
      search_description: INJECTED_DESCRIPTION,
      removal_date: '1.4.2026',
      remove_link: 'https://test.test/remove',
      renewal_link: 'https://test.test/renew',
      search_link: '/fi/search?a=1&b=2',
    },
    baseConfig,
  );

  assert.ok(html.includes(`<p>${ESCAPED_DESCRIPTION}</p>`), 'Description must be escaped');
  assert.ok(html.includes('<a href="https://test.test/fi/search?a=1&amp;b=2">search</a>'));
});

test('buildSearchLink keeps same-origin paths and query strings', () => {
  const cases: [string, string, string][] = [
    [
      'https://www.hel.fi',
      '/fi/avoimet-tyopaikat?task_areas=1&page=2',
      'https://www.hel.fi/fi/avoimet-tyopaikat?task_areas=1&amp;page=2',
    ],
    ['https://www.test.hel.ninja/', '/fi/haku', 'https://www.test.hel.ninja/fi/haku'],
    ['https://www.hel.fi', '?q=test', 'https://www.hel.fi/?q=test'],
    ['https://www.hel.fi', '', 'https://www.hel.fi/'],
  ];

  for (const [base, query, expected] of cases) {
    assert.equal(buildSearchLink(base, query), expected, `${base} + ${query}`);
  }
  assert.equal(buildSearchLink('https://www.hel.fi', undefined), 'https://www.hel.fi/');
});

test('buildSearchLink rejects links to other origins', () => {
  const attacks = [
    '@attacker.example/',
    '//attacker.example/',
    '/\\attacker.example/',
    '\\attacker.example',
    'https://attacker.example/',
    'javascript:alert(1)',
    '.attacker.example',
    // The URL parser strips tabs and newlines, so only the origin check rejects these.
    '/\t/attacker.example/',
    '/\n/attacker.example/',
    '/\r\n/attacker.example/',
    '\t//attacker.example/',
    // Same origin through userinfo, but the link would show another host.
    '//attacker.example@www.hel.fi/',
    '/\\attacker.example@www.hel.fi/',
  ];

  for (const query of attacks) {
    assert.equal(buildSearchLink('https://www.hel.fi', query), 'https://www.hel.fi/', `Should reject ${query}`);
  }
});

test('buildSearchLink percent-encodes quotes and angle brackets from the query', () => {
  const link = buildSearchLink('https://www.hel.fi', '/fi/haku?q="><script>alert(1)</script>');

  assert.ok(!link.includes('"'), 'Must not contain a double quote');
  assert.ok(!link.includes('<'), 'Must not contain <');
  assert.ok(!link.includes('>'), 'Must not contain >');
  assert.ok(link.startsWith('https://www.hel.fi/fi/haku?q='));
});

test('newHitsEmail escapes hit fields and keeps hit urls on the site origin', async () => {
  const configWithFormats: SiteConfigurationType = { ...baseConfig, fieldFormats: { url: 'url' } };

  const html = await newHitsEmail(
    'fi',
    {
      hits: [
        { title: ['Sosiaali- & terveys <b>'], url: ['/fi/avoimet-tyopaikat/job-1'] },
        { title: ['Other'], url: ['@attacker.example/'] },
      ],
      search_description: 'Haku',
      search_link: '/fi/search',
      remove_link: 'https://test.test/remove',
      created_date: '1.1.2026',
      expiry_date: '1.4.2026',
    },
    configWithFormats,
  );

  assert.ok(
    html.includes(
      '<li><a href="https://test.test/fi/avoimet-tyopaikat/job-1">Sosiaali- &amp; terveys &lt;b&gt;</a></li>',
    ),
  );
  assert.ok(
    html.includes('<li><a href="https://test.test/">Other</a></li>'),
    'Off-site url must fall back to base url',
  );
});

test('newHitsSms keeps hit fields and search_description as plain text', async () => {
  const sms = await newHitsSms(
    'fi',
    { hits: [{ address: ['Katu & tie'] }], search_description: 'A & B', id: '1' },
    baseConfig,
  );

  assert.ok(sms.includes('A & B'));
  assert.ok(sms.includes('Katu & tie'));
});
