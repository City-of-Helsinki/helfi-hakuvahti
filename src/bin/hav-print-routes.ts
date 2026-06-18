import Fastify from 'fastify';
import app, { options } from '../app.ts';

const server = Fastify({ logger: false });

server.register(app, options);

await server.ready();
console.log(server.printRoutes());
await server.close();
