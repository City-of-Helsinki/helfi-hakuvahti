import { sprightly } from 'sprightly';
import type { PartialDrupalNodeType } from '../types/elasticproxy';
import type { SiteConfigurationType } from '../types/siteConfig';
import type { SubscriptionCollectionLanguageType } from '../types/subscription';

const TEMPLATE_BASE_PATH = 'dist/templates';

export const translate = (
  key: string,
  lang: SubscriptionCollectionLanguageType,
  siteConfig: SiteConfigurationType,
): string => siteConfig.translations?.[key]?.[lang] ?? '';

type SprightlyContext = Record<string, string>;

export const buildTranslationContext = (
  lang: SubscriptionCollectionLanguageType,
  siteConfig: SiteConfigurationType,
): SprightlyContext => {
  const context: SprightlyContext = {};
  const entries = siteConfig.translations ? Object.entries(siteConfig.translations) : [];
  entries.forEach(([key, value]) => {
    context[key] = value[lang] ?? '';
  });
  return context;
};

export const wrapWithLayout = (
  innerTemplatePath: string,
  innerTemplateData: SprightlyContext,
  lang: SubscriptionCollectionLanguageType,
  title: string,
  siteConfig: SiteConfigurationType,
) => {
  const translations = buildTranslationContext(lang, siteConfig);
  const templateData: SprightlyContext = {
    ...translations,
    ...innerTemplateData,
  };
  const innerContent = sprightly(innerTemplatePath, templateData);
  const now = new Date();
  const year = String(now.getFullYear());

  const layoutData: SprightlyContext = {
    ...translations,
    lang,
    title,
    content: innerContent,
    year,
  };

  return sprightly(`${TEMPLATE_BASE_PATH}/${siteConfig.mail.templatePath}/index.html`, layoutData);
};

// SMS verification code
export const verifySms = async (
  lang: SubscriptionCollectionLanguageType,
  data: { code: string },
  siteConfig: SiteConfigurationType,
) =>
  sprightly(`${TEMPLATE_BASE_PATH}/${siteConfig.mail.templatePath}/sms/verify.txt`, {
    ...buildTranslationContext(lang, siteConfig),
    code: data.code,
  });

// Subscription confirmation SMS
export const confirmationSms = async (
  lang: SubscriptionCollectionLanguageType,
  data: { id: string; sms_code: string },
  siteConfig: SiteConfigurationType,
) =>
  sprightly(`${TEMPLATE_BASE_PATH}/${siteConfig.mail.templatePath}/sms/confirmation.txt`, {
    ...buildTranslationContext(lang, siteConfig),
    sms_code: data.sms_code,
    id: data.id,
  });

// Subscription confirmation email
export const confirmationEmail = async (
  lang: SubscriptionCollectionLanguageType,
  data: { link: string; search_description: string | undefined },
  siteConfig: SiteConfigurationType,
) =>
  wrapWithLayout(
    `${TEMPLATE_BASE_PATH}/${siteConfig.mail.templatePath}/confirmation.html`,
    {
      lang,
      link: data.link,
      search_description: data.search_description?.toLowerCase() ?? '',
    },
    lang,
    translate('email_subject_confirmation', lang, siteConfig),
    siteConfig,
  );

// Notification before subscription expires
export const expiryEmail = async (
  lang: SubscriptionCollectionLanguageType,
  data: {
    link: string;
    search_description: string;
    removal_date: string;
    remove_link: string;
    renewal_link: string;
    search_link: string;
  },
  siteConfig: SiteConfigurationType,
) =>
  wrapWithLayout(
    `${TEMPLATE_BASE_PATH}/${siteConfig.mail.templatePath}/expiry_notification.html`,
    {
      lang,
      link: data.link,
      search_description: data.search_description,
      remove_link: data.remove_link,
      removal_date: data.removal_date,
      renewal_link: data.renewal_link,
      search_link: siteConfig.urls.base + data.search_link,
    },
    lang,
    translate('email_subject_expiry', lang, siteConfig),
    siteConfig,
  );

// Email with list of new search monitor hits
export const newHitsEmail = async (
  lang: SubscriptionCollectionLanguageType,
  data: {
    hits: PartialDrupalNodeType[];
    search_description: string;
    search_link: string;
    remove_link: string;
    created_date: string;
    expiry_date: string;
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

    return wrapWithLayout(
      `${TEMPLATE_BASE_PATH}/${siteConfig.mail.templatePath}/newhits.html`,
      {
        lang,
        hits: hitsContent,
        search_link: siteConfig.urls.base + data.search_link,
        remove_link: data.remove_link,
        search_description: data.search_description,
        created_date: data.created_date,
        expiry_date: data.expiry_date,
      },
      lang,
      translate('email_subject_newhits', lang, siteConfig),
      siteConfig,
    );
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
    id: string;
  },
  siteConfig: SiteConfigurationType,
) =>
  sprightly(`${TEMPLATE_BASE_PATH}/${siteConfig.mail.templatePath}/sms/newhits.txt`, {
    ...buildTranslationContext(lang, siteConfig),
    search_description: data.search_description,
    id: data.id,
  });

// SMS notification for subscription renewal
export const renewalSms = async (
  lang: SubscriptionCollectionLanguageType,
  data: {
    expiry_date: string;
    search_description: string;
    id: string;
  },
  siteConfig: SiteConfigurationType,
) =>
  sprightly(`${TEMPLATE_BASE_PATH}/${siteConfig.mail.templatePath}/sms/renew.txt`, {
    ...buildTranslationContext(lang, siteConfig),
    expiry_date: data.expiry_date,
    search_description: data.search_description,
    id: data.id,
  });
