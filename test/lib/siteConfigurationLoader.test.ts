import * as assert from 'node:assert';
import { test } from 'node:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SiteConfigurationLoader } from '../../src/lib/siteConfigurationLoader';

const mockRekryConfig = {
  name: 'rekry',
  local: {
    urls: {
      base: 'https://helfi-rekry.docker.so',
      en: 'https://helfi-rekry.docker.so/en',
      fi: 'https://helfi-rekry.docker.so/fi',
      sv: 'https://helfi-rekry.docker.so/sv',
    },
    subscription: {
      maxAge: 90,
      unconfirmedMaxAge: 5,
      expiryNotificationDays: 3,
    },
    mail: {
      templatePath: 'rekry',
    },
    elasticProxyUrl: 'http://localhost:9200',
  },
  dev: {
    urls: {
      base: 'https://helfi-rekry.docker.so',
      en: 'https://helfi-rekry.docker.so/en',
      fi: 'https://helfi-rekry.docker.so/fi',
      sv: 'https://helfi-rekry.docker.so/sv',
    },
    subscription: {
      maxAge: 90,
      unconfirmedMaxAge: 5,
      expiryNotificationDays: 3,
    },
    mail: {
      templatePath: 'rekry',
    },
    elasticProxyUrl: 'http://localhost:9200',
  },
  prod: {
    urls: {
      base: 'https://hel.fi',
      en: 'https://hel.fi/en',
      fi: 'https://hel.fi/fi',
      sv: 'https://hel.fi/sv',
    },
    subscription: {
      maxAge: 90,
      unconfirmedMaxAge: 5,
      expiryNotificationDays: 3,
    },
    mail: {
      templatePath: 'rekry',
    },
    elasticProxyUrl: 'http://localhost:9200',
  },
};

const mockAnotherConfig = {
  name: 'another-site',
  local: {
    urls: {
      base: 'https://another.docker.so',
      en: 'https://another.docker.so/en',
      fi: 'https://another.docker.so/fi',
      sv: 'https://another.docker.so/sv',
    },
    subscription: {
      maxAge: 60,
      unconfirmedMaxAge: 3,
      expiryNotificationDays: 2,
    },
    mail: {
      templatePath: 'another',
    },
    elasticProxyUrl: 'http://localhost:9200',
  },
  dev: {
    urls: {
      base: 'https://another.docker.so',
      en: 'https://another.docker.so/en',
      fi: 'https://another.docker.so/fi',
      sv: 'https://another.docker.so/sv',
    },
    subscription: {
      maxAge: 60,
      unconfirmedMaxAge: 3,
      expiryNotificationDays: 2,
    },
    mail: {
      templatePath: 'another',
    },
    elasticProxyUrl: 'http://localhost:9200',
  },
  prod: {
    urls: {
      base: 'https://another.hel.fi',
      en: 'https://another.hel.fi/en',
      fi: 'https://another.hel.fi/fi',
      sv: 'https://another.hel.fi/sv',
    },
    subscription: {
      maxAge: 60,
      unconfirmedMaxAge: 3,
      expiryNotificationDays: 2,
    },
    mail: {
      templatePath: 'another',
    },
    elasticProxyUrl: 'http://localhost:9200',
  },
};

let tempDir: string;
let originalCwd: string;
let originalEnv: string | undefined;

test('SiteConfigurationLoader', async (t) => {
  // Setup: Create temporary directory and mock files
  await t.before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'siteconfig-test-'));
    originalCwd = process.cwd();
    originalEnv = process.env.ENVIRONMENT;

    // Change to temp directory
    process.chdir(tempDir);

    // Create conf directory with test files
    const confDir = path.join(tempDir, 'conf');
    fs.mkdirSync(confDir);

    fs.writeFileSync(path.join(confDir, 'rekry.json'), JSON.stringify(mockRekryConfig, null, 2));

    fs.writeFileSync(path.join(confDir, 'another.json'), JSON.stringify(mockAnotherConfig, null, 2));
  });

  await t.after(async () => {
    // Cleanup
    process.chdir(originalCwd);
    if (originalEnv !== undefined) {
      process.env.ENVIRONMENT = originalEnv;
    } else {
      delete process.env.ENVIRONMENT;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Reset singleton instance for clean testing
    (SiteConfigurationLoader as any).instance = undefined;
  });

  await t.beforeEach(() => {
    // Reset singleton instance before each test
    (SiteConfigurationLoader as any).instance = undefined;

    // Reset environment to default
    process.env.ENVIRONMENT = 'local';

    // Ensure clean test files exist
    const confDir = path.join(tempDir, 'conf');
    if (fs.existsSync(confDir)) {
      // Remove all files
      const files = fs.readdirSync(confDir);
      for (const file of files) {
        fs.unlinkSync(path.join(confDir, file));
      }
    } else {
      fs.mkdirSync(confDir);
    }

    // Recreate original test files
    fs.writeFileSync(path.join(confDir, 'rekry.json'), JSON.stringify(mockRekryConfig, null, 2));

    fs.writeFileSync(path.join(confDir, 'another.json'), JSON.stringify(mockAnotherConfig, null, 2));
  });

  await t.test('getInstance returns singleton instance', () => {
    const instance1 = SiteConfigurationLoader.getInstance();
    const instance2 = SiteConfigurationLoader.getInstance();
    assert.strictEqual(instance1, instance2);
  });

  await t.test('getInstance auto-loads configurations', () => {
    process.env.ENVIRONMENT = 'local';

    const configs = SiteConfigurationLoader.getConfigurations();
    assert.strictEqual(Object.keys(configs).length, 2);
    assert.strictEqual(configs.rekry.name, 'rekry');
    assert.strictEqual(configs.rekry.urls.base, 'https://helfi-rekry.docker.so');
    assert.strictEqual(configs['another'].name, 'another-site');
  });

  await t.test('static getConfiguration uses prod environment when specified', () => {
    process.env.ENVIRONMENT = 'prod';

    const rekryConfig = SiteConfigurationLoader.getConfiguration('rekry');
    assert.strictEqual(rekryConfig?.urls.base, 'https://hel.fi');
  });

  await t.test('static getConfiguration uses local environment', () => {
    process.env.ENVIRONMENT = 'local';

    const rekryConfig = SiteConfigurationLoader.getConfiguration('rekry');
    assert.strictEqual(rekryConfig?.urls.base, 'https://helfi-rekry.docker.so');
  });

  await t.test('static getConfiguration returns specific site config', () => {
    process.env.ENVIRONMENT = 'local';

    const rekryConfig = SiteConfigurationLoader.getConfiguration('rekry');
    assert.ok(rekryConfig);
    assert.strictEqual(rekryConfig.id, 'rekry');
    assert.strictEqual(rekryConfig.name, 'rekry');
    assert.strictEqual(rekryConfig.subscription.maxAge, 90);
    assert.strictEqual(rekryConfig.mail.templatePath, 'rekry');
  });

  await t.test('static getConfiguration returns undefined for non-existent site', () => {
    process.env.ENVIRONMENT = 'local';

    const config = SiteConfigurationLoader.getConfiguration('non-existent');
    assert.strictEqual(config, undefined);
  });

  await t.test('static getSiteIds returns array of site IDs', () => {
    process.env.ENVIRONMENT = 'local';

    const siteIds = SiteConfigurationLoader.getSiteIds();
    assert.ok(Array.isArray(siteIds));
    assert.strictEqual(siteIds.length, 2);
    assert.ok(siteIds.includes('rekry'));
    assert.ok(siteIds.includes('another'));
  });

  await t.test('throws error when configuration directory does not exist', () => {
    // Remove conf directory
    fs.rmSync(path.join(tempDir, 'conf'), { recursive: true, force: true });

    assert.throws(() => SiteConfigurationLoader.getInstance(), /Configuration directory not found/);
  });

  await t.test('throws error when no JSON files found', () => {
    // Empty the conf directory
    const confDir = path.join(tempDir, 'conf');
    fs.rmSync(confDir, { recursive: true, force: true });
    fs.mkdirSync(confDir);

    assert.throws(() => SiteConfigurationLoader.getInstance(), /No JSON configuration files found/);
  });

  await t.test('throws error when environment not found in config', () => {
    process.env.ENVIRONMENT = 'staging'; // Not present in mock config

    // Ensure we have config files for this test
    const confDir = path.join(tempDir, 'conf');
    if (!fs.existsSync(path.join(confDir, 'rekry.json'))) {
      fs.writeFileSync(path.join(confDir, 'rekry.json'), JSON.stringify(mockRekryConfig, null, 2));
    }

    assert.throws(() => SiteConfigurationLoader.getInstance(), /Environment 'staging' not found in configuration/);
  });

  await t.test('throws error for invalid JSON file', () => {
    // Clean up first to ensure only this test file exists
    const confDir = path.join(tempDir, 'conf');
    const files = fs.readdirSync(confDir);
    for (const file of files) {
      fs.unlinkSync(path.join(confDir, file));
    }

    // Write invalid JSON
    fs.writeFileSync(path.join(confDir, 'invalid.json'), '{ invalid json');

    assert.throws(() => SiteConfigurationLoader.getInstance());
  });

  await t.test('throws error for missing required properties in config', () => {
    // Clean up first to ensure only this test file exists
    const confDir = path.join(tempDir, 'conf');
    const files = fs.readdirSync(confDir);
    for (const file of files) {
      fs.unlinkSync(path.join(confDir, file));
    }

    // Reset to local environment for this test
    process.env.ENVIRONMENT = 'local';

    // Write config without required properties
    fs.writeFileSync(
      path.join(confDir, 'missing-props.json'),
      JSON.stringify({
        name: 'test',
        local: {
          urls: { base: 'test' },
          // Missing subscription, mail, and elasticProxyUrl properties
        },
      }),
    );

    assert.throws(() => SiteConfigurationLoader.getInstance(), /Invalid environment configuration/);
  });

  await t.test('getInstance is idempotent (does not reload)', () => {
    process.env.ENVIRONMENT = 'local';

    const firstResult = SiteConfigurationLoader.getConfigurations();
    const secondResult = SiteConfigurationLoader.getConfigurations();

    assert.strictEqual(firstResult, secondResult);
  });
});
