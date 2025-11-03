import fastifySentry from '@immobiliarelabs/fastify-sentry';
import dotenv from 'dotenv';
import fastify from 'fastify';
import { newHitsSms } from '../lib/email';
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader';
import dialogi from '../plugins/dialogi';
import '../plugins/sentry';

dotenv.config();

const server = fastify({});
const release = process.env.SENTRY_RELEASE ?? '';

server.register(fastifySentry, {
  dsn: process.env.SENTRY_DSN,
  environment: process.env.ENVIRONMENT,
  release,
  setErrorHandler: true,
});

// Register only needed plugins
// eslint-disable-next-line no-void
void server.register(dialogi);

// Test script to verify SMS sending via Elisa Dialogi API
const app = async (): Promise<void> => {
  const testPhoneNumber = process.env.TEST_SMS_NUMBER;

  if (!testPhoneNumber) {
    console.error('ERROR: TEST_SMS_NUMBER environment variable not set');
    console.error('Please set TEST_SMS_NUMBER in your .env file (e.g., TEST_SMS_NUMBER=+358501234567)');
    process.exit(1);
  }

  console.log('=== SMS Sending Test ===');
  console.log(`Target number: ${testPhoneNumber}`);
  console.log(`Environment: ${process.env.ENVIRONMENT || 'dev'}\n`);

  try {
    // Load site configurations
    const configLoader = SiteConfigurationLoader.getInstance();
    await configLoader.loadConfigurations();

    // Use first available site configuration for testing (default to 'rekry')
    const siteConfigs = configLoader.getConfigurations();
    const siteId = Object.keys(siteConfigs)[0];
    const siteConfig = siteConfigs[siteId];

    if (!siteConfig) {
      throw new Error('No site configuration found. Please configure at least one site in conf/ directory.');
    }

    console.log(`Using site configuration: ${siteId}\n`);

    // Test with each language
    const languages = ['fi', 'sv', 'en'] as const;

    for (const lang of languages) {
      console.log(`Testing ${lang.toUpperCase()} SMS...`);

      // Generate SMS content with dummy data
      const smsContent = await newHitsSms(
        lang,
        {
          search_description: 'Test search: Open positions in Helsinki',
          search_link: '/fi/avoimet-tyopaikat?search=test',
        },
        siteConfig,
      );

      console.log(`Content: ${smsContent}`);

      // Send SMS via Dialogi API
      try {
        const response = await server.dialogi.sendSms(testPhoneNumber, smsContent);
        // Extract message ID from Dialogi response
        const messageId =
          response.messages?.[0]?.[testPhoneNumber]?.messageid ||
          Object.values(response.messages?.[0] || {})[0]?.messageid ||
          'N/A';
        console.log(`SMS Message ID: ${messageId}`);
      } catch (error) {
        console.error(`✗ Failed to send ${lang} SMS:`, error);
        throw error;
      }

      console.log('');
    }

    console.log('=== All SMS tests completed successfully ===');
  } catch (error) {
    console.error('\n=== SMS Test Failed ===');
    console.error(error);
    server.Sentry?.captureException(error);
    process.exit(1);
  }
};

server.get('/', async function handleRootRequest(_request, _reply) {
  await app();
  return { success: true };
});

server.ready((_err) => {
  // eslint-disable-next-line no-console
  console.log('fastify server ready');
  server.inject(
    {
      method: 'GET',
      url: '/',
    },
    function handleInjectResponse(_injectErr, response) {
      if (response) {
        // eslint-disable-next-line no-console
        console.log(JSON.parse(response.payload));
      }

      server.close();
    },
  );
});
