import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import { SubscriptionCollectionLanguageType } from '../types/subscription';

const localizedEnvVarPlugin: FastifyPluginAsync = async (fastify, opts) => {
  fastify.decorate('localizedEnvVar', (envVarBase: string, langCode: SubscriptionCollectionLanguageType): string | undefined => {
    return process.env[`${envVarBase}_${langCode.toUpperCase()}`];
  });
};

export default fp(localizedEnvVarPlugin);

declare module 'fastify' {
  export interface FastifyInstance {
    localizedEnvVar(envVarBase: string, langCode: string): string | undefined;
  }
}
