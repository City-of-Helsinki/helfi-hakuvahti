import { Type } from '@sinclair/typebox'

export enum Environment {
  PRODUCTION = 'production',
  STAGING = 'staging',
  DEV = 'dev',
  LOCAL = 'local',
}

export const EnvironmentType = Type.Enum(Environment)
