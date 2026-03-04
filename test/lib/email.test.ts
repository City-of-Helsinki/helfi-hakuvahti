import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { buildTranslationContext, newHitsSms, translate, wrapWithLayout } from '../../src/lib/email';
import type { SiteConfigurationType } from '../../src/types/siteConfig';
import type { SubscriptionCollectionLanguageType } from '../../src/types/subscription';

const TEMPLATE_ROOT = path.join('dist', 'templates', 'test');
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
  await fs.writeFile(
    INNER_TEMPLATE,
    '<div class="inner">{{ foo }}<span>{{ custom_value }}</span></div>',
    'utf-8',
  );
  await fs.writeFile(
    LAYOUT_TEMPLATE,
    '<html><body><main>{{ content }}</main><footer>{{ foo }} - {{ title }}</footer></body></html>',
    'utf-8',
  );
  await fs.writeFile(
    SMS_NEWHITS_TEMPLATE,
    'New results for {{ search_description }}: {{ hits }}',
    'utf-8',
  );
  await fs.writeFile(
    SMS_HIT_ITEM_TEMPLATE,
    '{{ address }} ({{ valid_from }} - {{ valid_to }})\n',
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

const executeWrap = (
  lang: SubscriptionCollectionLanguageType,
  customValue: string,
) =>
  wrapWithLayout(
    path.join('dist', 'templates', baseConfig.mail.templatePath, 'inner_fi.html'),
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
      valid_to: [1712160000],   // 2024-04-03 in epoch seconds
    },
    {
      address: ['Aleksanterinkatu 52'],
      valid_from: [1709568000],
      valid_to: [1714752000],   // 2024-05-03 in epoch seconds
    },
  ];

  const result = await newHitsSms(
    'fi',
    {
      hits,
      search_description: 'Testihaku',
      sms_code: '123456',
    },
    configWithFormats,
  );

  assert.ok(result.includes('Testihaku'), 'Should include search description');
  assert.ok(result.includes('Mannerheimintie 1'), 'Should include first hit address');
  assert.ok(result.includes('Aleksanterinkatu 52'), 'Should include second hit address');
  assert.match(result, /\d{2}\.\d{2}\.\d{4}/, 'Should include formatted dates');
});
