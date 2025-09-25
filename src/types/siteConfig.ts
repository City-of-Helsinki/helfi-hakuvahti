import { Static, Type } from '@sinclair/typebox'

export const SiteLanguageUrls = Type.Object({
  base: Type.String(),
  en: Type.String(),
  fi: Type.String(),
  sv: Type.String(),
})
export type SiteLanguageUrlsType = Static<typeof SiteLanguageUrls>

export const SiteSubscriptionSettings = Type.Object({
  maxAge: Type.Number(),
  unconfirmedMaxAge: Type.Number(),
  expiryNotificationDays: Type.Number(),
})
export type SiteSubscriptionSettingsType = Static<typeof SiteSubscriptionSettings>

export const SiteMailSettings = Type.Object({
  templatePath: Type.String(),
})
export type SiteMailSettingsType = Static<typeof SiteMailSettings>

export const SiteEnvironmentConfig = Type.Object({
  urls: SiteLanguageUrls,
  subscription: SiteSubscriptionSettings,
  mail: SiteMailSettings,
  elasticProxyUrl: Type.String(),
})
export type SiteEnvironmentConfigType = Static<typeof SiteEnvironmentConfig>

export const SiteConfigurationFile = Type.Object({
  name: Type.String(),
}, { additionalProperties: SiteEnvironmentConfig })
export type SiteConfigurationFileType = Static<typeof SiteConfigurationFile>

export const SiteConfiguration = Type.Object({
  id: Type.String(),
  name: Type.String(),
  urls: SiteLanguageUrls,
  subscription: SiteSubscriptionSettings,
  mail: SiteMailSettings,
  elasticProxyUrl: Type.String(),
})
export type SiteConfigurationType = Static<typeof SiteConfiguration>
export const SiteConfigurationMap = Type.Record(Type.String(), SiteConfiguration)
export type SiteConfigurationMapType = Static<typeof SiteConfigurationMap>
