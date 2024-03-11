import { Transporter } from 'nodemailer'
import { Static, Type } from '@sinclair/typebox'

export interface FastifyMailerNamedInstance {
  [namespace: string]: Transporter;
}

export type FastifyMailer = FastifyMailerNamedInstance & Transporter;

export const QueueDocument = Type.Object({
  _id: Type.Optional(Type.String()),
  email: Type.String(),
  content: Type.String(),
})

export type QueueDocumentType = Static<typeof QueueDocument>

export const QueueInsertDocument = Type.Object({
  email: Type.String(),
  content: Type.String(),
})

export type QueueInsertDocumentType = Static<typeof QueueInsertDocument>
