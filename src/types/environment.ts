import { Type } from '@sinclair/typebox'

export enum Environment {
  PRODUCTION = 'production',
  STAGING = 'staging',
  DEV = 'dev'
}

export const EnvironmentType = Type.Enum(Environment)
