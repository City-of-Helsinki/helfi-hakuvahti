declare global {
  namespace NodeJS {
    interface ProcessEnv {
    [key: string]: string | undefined | number;

    // Elastic Proxy url
    ELASTIC_PROXY_URL: string;

    // MongoDB connection
    MONGODB: string;

    // Fastify port and address
    FASTIFY_PORT: number;
    FASTIFY_ADDRESS: string | undefined;

    // ATV api key + url for secure storage
    ATV_API_KEY: string;
    ATV_API_URL: string;

    // Maximum age of subscription in days
    SUBSCRIPTION_MAX_AGE: number;

    // add more environment variables and their types here
    }
  }
}
