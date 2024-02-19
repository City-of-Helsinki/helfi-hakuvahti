import { Transporter } from 'nodemailer'

export interface FastifyMailerNamedInstance {
  [namespace: string]: Transporter;
}

export type FastifyMailer = FastifyMailerNamedInstance & Transporter;
