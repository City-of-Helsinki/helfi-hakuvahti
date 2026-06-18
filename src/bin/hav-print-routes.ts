import dotenv from 'dotenv';
import Fastify from 'fastify';
import app, { options } from '../app.ts';

// Replacement for `fastify print-routes`: build the full app and print its
// route tree, then exit.
dotenv.config();

const server = Fastify({ logger: false });

server.register(app, options);

await server.ready();
console.log(server.printRoutes());
await server.close();
