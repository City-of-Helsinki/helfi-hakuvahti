import { Type } from '@sinclair/typebox';

export const Environment = {
  PRODUCTION: 'production',
  STAGING: 'staging',
  DEV: 'dev',
  LOCAL: 'local',
} as const;
export type Environment = (typeof Environment)[keyof typeof Environment];

export const EnvironmentType = Type.Enum(Environment);

const EMAIL_DEBUG_ENVIRONMENTS: readonly string[] = [Environment.LOCAL, Environment.DEV, Environment.STAGING];

/** Unknown or missing values count as production. */
export const isEmailDebugEnvironment = (environment: string | undefined): boolean =>
  environment !== undefined && EMAIL_DEBUG_ENVIRONMENTS.includes(environment);
