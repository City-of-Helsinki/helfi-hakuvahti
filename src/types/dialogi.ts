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
  id: Type.Optional(Type.String()), // Message ID from Dialogi
  status: Type.Optional(Type.String()), // Status of the SMS
});

export type DialogiSmsResponseType = Static<typeof DialogiSmsResponse>;
