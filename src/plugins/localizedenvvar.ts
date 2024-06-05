import fp from 'fastify-plugin';
import { SubscriptionCollectionLanguageType } from '../types/subscription';

export interface localizedEnvVarPluginPluginOptions {
}

export const localizedEnvVar = (envVarBase: string, langCode: SubscriptionCollectionLanguageType): string | undefined => {
  return process.env[`${envVarBase}_${langCode.toUpperCase()}`]
}

export default fp<localizedEnvVarPluginPluginOptions>(async (fastify) => {
  fastify.decorate('localizedEnvVar', localizedEnvVar)
})

declare module 'fastify' {
  export interface FastifyInstance {
    localizedEnvVar(envVarBase: string, langCode: string): string | undefined;
  }
}
