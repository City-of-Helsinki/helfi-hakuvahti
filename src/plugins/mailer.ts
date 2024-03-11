import fp from 'fastify-plugin'
import { FastifyInstance } from 'fastify'
import { FastifyMailer } from '../types/mailer'

// Initialize mailer as plugin

export default fp(async function (fastify: FastifyInstance) {
  const opts = {
    defaults: { 
      from: process.env.MAIL_FROM 
    },
    transport: {
      host: process.env.MAIL_HOST,
      port: process.env.MAIL_PORT,
      secure: process.env.MAIL_SECURE,
      auth: {
        user: process.env.MAIL_AUTH_USER,
        pass: process.env.MAIL_AUTH_PASS
      }
    }
  }

  fastify.register(require('fastify-mailer'), opts)
})

declare module "fastify" {
  interface FastifyInstance {
    mailer: FastifyMailer;
  }
}
