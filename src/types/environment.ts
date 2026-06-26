import { Type } from '@sinclair/typebox';

export const Environment = {
  PRODUCTION: 'production',
  STAGING: 'staging',
  DEV: 'dev',
  LOCAL: 'local',
} as const;
export type Environment = (typeof Environment)[keyof typeof Environment];

export const EnvironmentType = Type.Enum(Environment);
