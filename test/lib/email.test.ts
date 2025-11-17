import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { buildTranslationContext, translate, wrapWithLayout } from '../../src/lib/email';
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

const createTestTemplates = async () => {
  await fs.mkdir(TEMPLATE_ROOT, { recursive: true });
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
