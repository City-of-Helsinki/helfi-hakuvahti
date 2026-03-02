import command from '../lib/command';
import { newHitsSms } from '../lib/email';
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader';
import dialogi from '../plugins/dialogi';
import '../plugins/sentry';

// Test script to verify SMS sending via Elisa Dialogi API
command(
  async (server) => {
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
      // Use first available site configuration for testing (default to 'rekry')
      const siteConfigs = SiteConfigurationLoader.getConfigurations();
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
  },
  [
    // Register only needed plugins
    dialogi,
  ],
);
