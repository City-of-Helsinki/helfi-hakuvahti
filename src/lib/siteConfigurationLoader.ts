import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  SiteConfigurationFileType,
  SiteConfigurationMapType,
  SiteConfigurationType,
  SiteEnvironmentConfigType,
} from '../types/siteConfig';

export class SiteConfigurationLoader {
  private static instance: SiteConfigurationLoader;

  private configurations: SiteConfigurationMapType = {};

  private loaded = false;

  // eslint-disable-next-line no-empty-function
  private constructor() {}

  public static getInstance(): SiteConfigurationLoader {
    if (!SiteConfigurationLoader.instance) {
      SiteConfigurationLoader.instance = new SiteConfigurationLoader();
    }

    return SiteConfigurationLoader.instance;
  }

  public async loadConfigurations(): Promise<void> {
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

    // eslint-disable-next-line no-restricted-syntax
    for (const file of files) {
      const siteId = path.basename(file, '.json');
      const filePath = path.join(configDir, file);

      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const rawConfig: SiteConfigurationFileType = JSON.parse(fileContent);

        if (!this.validateRawConfiguration(rawConfig)) {
          throw new Error(`Invalid configuration structure in ${filePath}`);
        }

        // Extract environment-specific config
        const envConfig = (rawConfig as any)[environment] as SiteEnvironmentConfigType;
        if (!envConfig) {
          throw new Error(`Environment '${environment}' not found in configuration ${filePath}`);
        }

        if (!this.validateEnvironmentConfiguration(envConfig)) {
          throw new Error(`Invalid environment configuration for '${environment}' in ${filePath}`);
        }

        // Flatten to runtime configuration
        this.configurations[siteId] = {
          id: siteId,
          name: rawConfig.name,
          urls: envConfig.urls,
          subscription: envConfig.subscription,
          mail: envConfig.mail,
          elasticProxyUrl: envConfig.elasticProxyUrl,
        };
      } catch (error) {
        throw new Error(`Failed to load configuration from ${filePath}: ${error}`);
      }
    }

    this.loaded = true;
  }

  /**
   * Gets all loaded site configurations
   * @return {SiteConfigurationMapType} The loaded site configurations
   */
  public getConfigurations(): SiteConfigurationMapType {
    if (!this.loaded) {
      throw new Error('Configurations not loaded. Call loadConfigurations() first.');
    }
    return this.configurations;
  }

  /**
   * Gets a specific site configuration by ID
   * @param {string} siteId - The site ID to get configuration for
   * @return {SiteConfigurationType | undefined} The site configuration or undefined if not found
   */
  public getConfiguration(siteId: string): SiteConfigurationType | undefined {
    if (!this.loaded) {
      throw new Error('Configurations not loaded. Call loadConfigurations() first.');
    }
    return this.configurations[siteId];
  }

  public getSiteIds(): string[] {
    if (!this.loaded) {
      throw new Error('Configurations not loaded. Call loadConfigurations() first.');
    }
    return Object.keys(this.configurations);
  }

  /**
   * Validates that a raw configuration file has required properties
   * @param {unknown} config - The configuration object to validate
   * @return {boolean} True if configuration is valid
   */
  // eslint-disable-next-line class-methods-use-this
  public validateRawConfiguration(config: unknown): config is SiteConfigurationFileType {
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
   * @param {unknown} config - The configuration object to validate
   * @return {boolean} True if environment configuration is valid
   */
  // eslint-disable-next-line class-methods-use-this
  public validateEnvironmentConfiguration(config: unknown): config is SiteEnvironmentConfigType {
    if (typeof config !== 'object' || config === null) {
      return false;
    }
    const required = ['urls', 'subscription', 'mail', 'elasticProxyUrl'];
    return required.every((prop) => prop in config);
  }
}
