declare global {
  namespace NodeJS {
    interface ProcessEnv {
    [key: string]: string | undefined | number;
    ELASTIC_PROXY_URL: string;
    MONGODB: string;
    FASTIFY_PORT: number;
    FASTIFY_ADDRESS: string | undefined;

    // add more environment variables and their types here
    }
  }
}
