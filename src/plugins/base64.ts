import fp from 'fastify-plugin'
import { Buffer } from 'buffer'

// Helper plugin to encode/decode base64

export interface Base64PluginOptions {
}

export const decode = (str: string):string => Buffer.from(str, 'base64').toString('binary');
const encode = (str: string):string => Buffer.from(str, 'binary').toString('base64');

export default fp<Base64PluginOptions>(async (fastify, opts) => {
  fastify.decorate('b64decode', decode)
  fastify.decorate('b64encode', encode)
})

declare module 'fastify' {
  export interface FastifyInstance {
    b64encode(input: string): string;
    b64decode(input: string): string;
  }
}
