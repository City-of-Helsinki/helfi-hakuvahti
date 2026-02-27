import { type Static, Type } from '@sinclair/typebox';

export const SiteLanguageUrls = Type.Object({
  base: Type.String(),
  en: Type.String(),
  fi: Type.String(),
  sv: Type.String(),
});
export type SiteLanguageUrlsType = Static<typeof SiteLanguageUrls>;

const TranslationValue = Type.Object({
  fi: Type.String(),
  en: Type.String(),
  sv: Type.String(),
});
export type TranslationValueType = Static<typeof TranslationValue>;

export const TranslationMap = Type.Record(Type.String(), TranslationValue);
export type TranslationMapType = Static<typeof TranslationMap>;

export const SiteSubscriptionSettings = Type.Object({
  maxAge: Type.Number(),
  unconfirmedMaxAge: Type.Number(),
  expiryNotificationDays: Type.Number(),
  enableSms: Type.Optional(Type.Boolean()),
  smsCodeExpireConfirmMinutes: Type.Optional(Type.Number()),
  smsCodeExpireActionMinutes: Type.Optional(Type.Number()),
  matchField: Type.Optional(Type.String()),
});
export type SiteSubscriptionSettingsType = Static<typeof SiteSubscriptionSettings>;

export const SiteMailSettings = Type.Object({
  templatePath: Type.String(),
  maxHitsInEmail: Type.Optional(Type.Number()),
  fieldFormats: Type.Optional(Type.Record(Type.String(), Type.String())),
});
export type SiteMailSettingsType = Static<typeof SiteMailSettings>;

export const SiteEnvironmentConfig = Type.Object({
  urls: SiteLanguageUrls,
  subscription: SiteSubscriptionSettings,
  mail: SiteMailSettings,
  elasticProxyUrl: Type.String(),
});
export type SiteEnvironmentConfigType = Static<typeof SiteEnvironmentConfig>;

export const SiteConfigurationFile = Type.Object(
  {
    name: Type.String(),
    translations: Type.Optional(TranslationMap),
  },
  { additionalProperties: SiteEnvironmentConfig },
);
export type SiteConfigurationFileType = Static<typeof SiteConfigurationFile>;

export const SiteConfiguration = Type.Object({
  id: Type.String(),
  name: Type.String(),
  urls: SiteLanguageUrls,
  subscription: SiteSubscriptionSettings,
  mail: SiteMailSettings,
  elasticProxyUrl: Type.String(),
  translations: Type.Optional(TranslationMap),
});
export type SiteConfigurationType = Static<typeof SiteConfiguration>;
export const SiteConfigurationMap = Type.Record(Type.String(), SiteConfiguration);
export type SiteConfigurationMapType = Static<typeof SiteConfigurationMap>;
