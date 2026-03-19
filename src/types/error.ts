import { type Static, Type } from '@sinclair/typebox';

export const GenericResponse = Type.Object({
  statusMessage: Type.String(),
});

export type GenericResponseType = Static<typeof GenericResponse>;

export const Generic400Error = Type.Object({
  error: Type.String(),
  field: Type.Optional(Type.String()),
});

export type Generic400ErrorType = Static<typeof Generic400Error>;

export const Generic500Error = Type.Object({
  email: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
});

export type Generic500ErrorType = Static<typeof Generic500Error>;
