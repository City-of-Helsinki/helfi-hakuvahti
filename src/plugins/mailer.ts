import fp from 'fastify-plugin'
import { FastifyInstance } from 'fastify'
import { Transporter } from 'nodemailer'

export interface FastifyMailerNamedInstance {
  [namespace: string]: Transporter;
}

export type FastifyMailer = FastifyMailerNamedInstance & Transporter;

export default fp(async function (fastify: FastifyInstance) {
  fastify.register(require('fastify-mailer'), {
    defaults: { 
      from: process.env.MAIl_FROM 
    },
    transport: {
      host: process.env.MAIL_HOST,
      port: process.env.MAIL_PORT,
      secure: process.env.MAIL_SECURE, // use TLS
      auth: {
        user: process.env.MAIL_AUTH_USER,
        pass: process.env.MAIL_AUTH_PASS
      }
    }
  })
})

declare module "fastify" {
  interface FastifyInstance {
    mailer: FastifyMailer;
  }
}
