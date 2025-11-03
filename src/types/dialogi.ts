import { type Static, Type } from '@sinclair/typebox';

// Request types for Elisa Dialogi SMS API
export const DialogiSmsRequest = Type.Object({
  sender: Type.String(), // Message sender (phone number, shortcode, or alphanumeric max 11 chars)
  destination: Type.String(), // Phone number in international format (E.164)
  text: Type.String(), // SMS message content
});

export type DialogiSmsRequestType = Static<typeof DialogiSmsRequest>;

// Response types for Elisa Dialogi SMS API
export const DialogiSmsResponse = Type.Object({
  messages: Type.Optional(
    Type.Array(
      Type.Record(
        Type.String(),
        Type.Object({
          converted: Type.Optional(Type.String()),
          status: Type.Optional(Type.String()),
          reason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          messageid: Type.Optional(Type.String()),
        }),
      ),
    ),
  ),
  warnings: Type.Optional(Type.Array(Type.Object({ message: Type.String() }))),
  errors: Type.Optional(Type.Array(Type.Object({ message: Type.String() }))),
});

export type DialogiSmsResponseType = Static<typeof DialogiSmsResponse>;
