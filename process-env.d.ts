declare global {
  namespace NodeJS {
    interface ProcessEnv {
    [key: string]: string | undefined | number;
    MONGODB: string;
    FASTIFY_PORT: number;
    FASTIFY_ADDRESS: string | undefined;

    // add more environment variables and their types here
    }
  }
}
