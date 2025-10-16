import { sprightly } from 'sprightly';
import type { PartialDrupalNodeType } from '../types/elasticproxy';
import type { SiteConfigurationType } from '../types/siteConfig';
import type { SubscriptionCollectionLanguageType } from '../types/subscription';

// Subscription confirmation email
export const confirmationEmail = async (
  lang: SubscriptionCollectionLanguageType,
  data: { link: string },
  siteConfig: SiteConfigurationType,
) =>
  sprightly(`dist/templates/${siteConfig.mail.templatePath}/confirmation_${lang}.html`, {
    lang,
    link: data.link,
  });

// Notification before subscription expires
export const expiryEmail = async (
  lang: SubscriptionCollectionLanguageType,
  data: {
    link: string;
    search_description: string;
    removal_date: string;
    remove_link: string;
  },
  siteConfig: SiteConfigurationType,
) =>
  sprightly(`dist/templates/${siteConfig.mail.templatePath}/expiry_notification_${lang}.html`, {
    lang,
    link: data.link,
    search_description: data.search_description,
    remove_link: data.remove_link,
    removal_date: data.removal_date,
  });

// Email with list of new search monitor hits
export const newHitsEmail = async (
  lang: SubscriptionCollectionLanguageType,
  data: {
    hits: PartialDrupalNodeType[];
    search_description: string;
    search_link: string;
    remove_link: string;
    created_date: string;
  },
  siteConfig: SiteConfigurationType,
) => {
  try {
    const hitsContent = data.hits
      .map((item) =>
        sprightly('dist/templates/link_text.html', {
          link: siteConfig.urls.base + item.url,
          content: item.title,
        }),
      )
      .join('');

    return sprightly(`dist/templates/${siteConfig.mail.templatePath}/newhits_${lang}.html`, {
      lang,
      hits: hitsContent,
      search_link: siteConfig.urls.base + data.search_link,
      remove_link: data.remove_link,
      search_description: data.search_description,
      created_date: data.created_date,
    });
  } catch (error) {
    console.error(error);
    throw error;
  }
};

// SMS notification for new search results
export const newHitsSms = async (
  lang: SubscriptionCollectionLanguageType,
  data: {
    search_description: string;
    search_link: string;
  },
  siteConfig: SiteConfigurationType,
) =>
  sprightly(`dist/templates/${siteConfig.mail.templatePath}/sms/sms-${lang}.html`, {
    lang,
    search_description: data.search_description,
    search_link: siteConfig.urls.base + data.search_link,
  });
