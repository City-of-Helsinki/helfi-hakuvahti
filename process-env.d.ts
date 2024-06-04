declare global {
  namespace NodeJS {
    interface ProcessEnv {
      [key: string]: string | undefined | number;

      ENVIRONMENT: string;

      // Elastic Proxy url
      ELASTIC_PROXY_URL: string;

      // Base url for the website
      BASE_URL_FI: string;
      BASE_URL_EN: string;
      BASE_URL_SV: string;

      // MongoDB connection
      MONGODB: string;

      // Sentry
      SENTRY_DSN: string;

      // Fastify port and address
      FASTIFY_PORT: number;
      FASTIFY_ADDRESS: string | undefined;

      // ATV api key + url for secure storage
      ATV_API_KEY: string;
      ATV_API_URL: string;

      // Maximum age of subscription in days
      SUBSCRIPTION_MAX_AGE: number;
      UNCONFIRMED_SUBSCRIPTION_MAX_AGE: number;
      SUBSCRIPTION_EXPIRY_NOTIFICATION_DAYS: number;

      // SMTP
      MAIL_FROM: string;
      MAIL_HOST: string;
      MAIL_PORT: string;
      MAIL_SECURE: string;
      MAIL_AUTH_USER: string;
      MAIL_AUTH_PASS: string;

      // Email templates
      MAIL_TEMPLATE_PATH: string;

      // add more environment variables and their types here
    }
  }
}
