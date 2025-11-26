import command from '../lib/command';
import { confirmationEmail, expiryEmail, newHitsEmail } from '../lib/email';
import { SiteConfigurationLoader } from '../lib/siteConfigurationLoader';
import mongodb from '../plugins/mongodb';
import type { PartialDrupalNodeType } from '../types/elasticproxy';
import type { QueueInsertDocumentType } from '../types/mailer';
import type { SubscriptionCollectionLanguageType } from '../types/subscription';

// npm run hav:test-email-templates -- --site=rekry

// Dummy data
const DUMMY_DATA = {
  confirmation: {
    link: 'https://dummyconfirmation',
    search_description: 'Testihaku',
  },
  expiry: {
    link: 'https://dummysearch',
    search_description: 'IT-asiantuntija',
    removal_date: '31.12.2025',
    remove_link: 'https://dummyremove',
    renewal_link: 'https://dummyrenew',
    search_link: '/fi/avoimet-tyopaikat/etsi-avoimia-tyopaikkoja',
  },
  newhits: {
    hits: [
      {
        _language: 'fi',
        entity_type: ['node'],
        url: ['/fi/avoimet-tyopaikat/etsi-avoimia-tyopaikkoja'],
        langcode: ['fi'],
        title: 'IT-asiantuntija, Kaupunkiympäristön toimiala',
        field_publication_starts: [Date.now()],
      } as unknown as PartialDrupalNodeType,
      {
        _language: 'fi',
        entity_type: ['node'],
        url: ['/fi/avoimet-tyopaikat/etsi-avoimia-tyopaikkoja'],
        langcode: ['fi'],
        title: 'Ohjelmistokehittäjä',
        field_publication_starts: [Date.now()],
      } as unknown as PartialDrupalNodeType,
      {
        _language: 'fi',
        entity_type: ['node'],
        url: ['/fi/avoimet-tyopaikat/etsi-avoimia-tyopaikkoja'],
        langcode: ['fi'],
        title: 'Tietoturva-asiantuntija, Keskushallinto',
        field_publication_starts: [Date.now()],
      } as unknown as PartialDrupalNodeType,
    ],
    search_description: 'IT-asiantuntija',
    search_link: '/fi/avoimet-tyopaikat/etsi-avoimia-tyopaikkoja',
    remove_link: 'https://dummy/remove/xyz789',
    created_date: '15.11.2025',
    expiry_date: '15.02.2026',
  },
};

const LANGUAGES: SubscriptionCollectionLanguageType[] = ['fi', 'en', 'sv'];

command(
  async (server, argv) => {
    if (!argv.site) {
      throw new Error('--site parameter required');
    }

    if (server.mongo?.db === undefined) {
      throw new Error('MongoDB unavailable');
    }

    const subscriptionCollection = server.mongo.db.collection('subscription');
    const latestSubscription = await subscriptionCollection.findOne(
      {},
      { sort: { _id: -1 }, projection: { email: 1 } },
    );

    if (!latestSubscription?.email) {
      throw new Error('Create test subscription first.');
    }

    const siteId = argv.site;
    const testEmail = latestSubscription.email;

    console.log(`Site: ${siteId}`);

    const configLoader = SiteConfigurationLoader.getInstance();
    await configLoader.loadConfigurations();
    const siteConfig = configLoader.getConfiguration(siteId);

    if (!siteConfig) {
      throw new Error('Site configuration not found');
    }

    console.log(`Template path: ${siteConfig.mail.templatePath}`);

    const queueCollection = server.mongo.db.collection('queue');

    for (const lang of LANGUAGES) {
      const confirmationHtml = await confirmationEmail(lang, DUMMY_DATA.confirmation, siteConfig);
      const confirmationEmailDoc: QueueInsertDocumentType = {
        email: testEmail,
        content: confirmationHtml,
      };
      await queueCollection.insertOne(confirmationEmailDoc);
      console.log('Confirmation email queued');

      const expiryHtml = await expiryEmail(lang, DUMMY_DATA.expiry, siteConfig);
      const expiryEmailDoc: QueueInsertDocumentType = {
        email: testEmail,
        content: expiryHtml,
      };
      await queueCollection.insertOne(expiryEmailDoc);
      console.log('Expiry notification queued');

      const newhitsHtml = await newHitsEmail(lang, DUMMY_DATA.newhits, siteConfig);
      const newhitsEmailDoc: QueueInsertDocumentType = {
        email: testEmail,
        content: newhitsHtml,
      };
      await queueCollection.insertOne(newhitsEmailDoc);
      console.log('New hits email queued');
    }
  },
  [mongodb],
);
