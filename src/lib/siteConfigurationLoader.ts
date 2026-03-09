import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  SiteConfigurationFileType,
  SiteConfigurationMapType,
  SiteConfigurationType,
  SiteEnvironmentConfigType,
} from '../types/siteConfig';
import type { SubscriptionCollectionLanguageType } from '../types/subscription';

export class SiteConfigurationLoader {
  private static instance: SiteConfigurationLoader;

  private configurations: SiteConfigurationMapType = {};

  private loaded = false;

  private constructor() {}

  public static getInstance(): SiteConfigurationLoader {
    if (!SiteConfigurationLoader.instance) {
      SiteConfigurationLoader.instance = new SiteConfigurationLoader();
      SiteConfigurationLoader.instance.loadConfigurations();
    }

    return SiteConfigurationLoader.instance;
  }

  /**
   * Gets all loaded site configurations
   * @return {SiteConfigurationMapType} The loaded site configurations
   */
  static getConfigurations(): SiteConfigurationMapType {
    return SiteConfigurationLoader.getInstance().configurations;
  }

  /**
   * Gets a specific site configuration by ID
   * @param siteId - The site ID to get configuration for
   * @return The site configuration or undefined if not found
   */
  static getConfiguration(siteId: string): SiteConfigurationType | undefined {
    return SiteConfigurationLoader.getInstance().configurations[siteId];
  }

  static getSiteIds(): string[] {
    return Object.keys(SiteConfigurationLoader.getInstance().configurations);
  }

  static getLocalizedUrl(siteConfig: SiteConfigurationType, langCode: SubscriptionCollectionLanguageType): string {
    const langKey = langCode.toLowerCase();
    if (langKey in siteConfig.urls) {
      return siteConfig.urls[langKey as keyof typeof siteConfig.urls];
    }
    return siteConfig.urls.base;
  }

  private loadConfigurations(): void {
    if (this.loaded) {
      return;
    }

    const environment = process.env.ENVIRONMENT || 'dev';
    const configDir = path.resolve(process.cwd(), 'conf');

    if (!fs.existsSync(configDir)) {
      throw new Error(`Configuration directory not found: ${configDir}`);
    }

    const files = fs.readdirSync(configDir).filter((file) => file.endsWith('.json'));

    if (files.length === 0) {
      throw new Error('No JSON configuration files found in conf/ directory');
    }

    for (const file of files) {
      const siteId = path.basename(file, '.json');
      const filePath = path.join(configDir, file);

      const fileContent = fs.readFileSync(filePath, 'utf8');
      const rawConfig: SiteConfigurationFileType = JSON.parse(fileContent);

      if (!this.validateRawConfiguration(rawConfig)) {
        throw new Error(`Invalid configuration structure in ${filePath}`);
      }

      // Extract environment-specific config
      const envConfig = (rawConfig as Record<string, unknown>)[environment] as SiteEnvironmentConfigType;
      if (!envConfig) {
        throw new Error(`Environment '${environment}' not found in configuration ${filePath}`);
      }

      if (!this.validateEnvironmentConfiguration(envConfig)) {
        throw new Error(`Invalid environment configuration for '${environment}' in ${filePath}`);
      }

      const translations = rawConfig.translations ?? undefined;
      const fieldFormats = rawConfig.fieldFormats ?? undefined;

      // Flatten to runtime configuration
      this.configurations[siteId] = {
        id: siteId,
        name: rawConfig.name,
        urls: envConfig.urls,
        subscription: envConfig.subscription,
        mail: envConfig.mail,
        elasticProxyUrl: envConfig.elasticProxyUrl,
        translations,
        matchField: rawConfig.matchField,
        fieldFormats,
      };
    }

    this.loaded = true;
  }

  /**
   * Validates that a raw configuration file has required properties
   * @param config - The configuration object to validate
   * @return True if configuration is valid
   */
  private validateRawConfiguration(config: unknown): config is SiteConfigurationFileType {
    if (typeof config !== 'object' || config === null) {
      return false;
    }
    const configObj = config as Record<string, unknown>;

    // Must have 'name' property
    if (!('name' in configObj) || typeof configObj.name !== 'string') {
      return false;
    }

    // Must have at least one environment configuration (excluding 'name')
    const envKeys = Object.keys(configObj).filter((key) => key !== 'name');
    return envKeys.length > 0;
  }

  /**
   * Validates that an environment-specific configuration has required properties
   * @param config - The configuration object to validate
   * @return True if environment configuration is valid
   */
  private validateEnvironmentConfiguration(config: unknown): config is SiteEnvironmentConfigType {
    if (typeof config !== 'object' || config === null) {
      return false;
    }
    const required = ['urls', 'subscription', 'mail', 'elasticProxyUrl'];
    return required.every((prop) => prop in config);
  }
}
