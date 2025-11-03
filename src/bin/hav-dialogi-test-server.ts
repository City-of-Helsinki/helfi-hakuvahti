import dotenv from 'dotenv';
import fastify from 'fastify';

dotenv.config();

/**
 * Mock Dialogi SMS API server for local testing
 *
 * This is a minimal HTTP server that mimics the Elisa Dialogi API responses.
 * Use this for local development when you don't have access to the real Dialogi API.
 *
 * Usage:
 * 1. Run: npm run hav:run-dialogi-test-server
 * 2. Set in .env: DIALOGI_API_URL=http://localhost:3001/sms
 * 3. Test your SMS pipeline locally
 */

const PORT = 3001;

const server = fastify({
  logger: true,
});

// Mock Dialogi SMS endpoint
server.post('/sms', async (request, reply) => {
  const body = request.body as {
    sender?: string;
    destination?: string;
    text?: string;
  };

  const { sender, destination, text } = body;

  // Log the "sent" SMS
  server.log.info('MOCK SMS SENT');
  server.log.info(`From: ${sender || 'unknown'}`);
  server.log.info(`To: ${destination || 'unknown'}`);
  server.log.info(`Message: ${text || 'empty'}`);

  // Return a mock Dialogi API response (based on their API structure)
  const mockMessageId = `mock-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  return reply.code(200).send({
    messages: [
      {
        [destination || 'unknown']: {
          converted: destination,
          status: 'OK',
          reason: null,
          messageid: mockMessageId,
        },
      },
    ],
    warnings: [],
    errors: [],
  });
});

// Health check endpoint
server.get('/health', async (_request, reply) => {
  return reply.code(200).send({
    status: 'ok',
    service: 'Mock Dialogi API',
    timestamp: new Date().toISOString(),
  });
});

// Start server
const start = async () => {
  try {
    await server.listen({ port: PORT, host: '0.0.0.0' });
    console.log('');
    console.log('Mock Dialogi SMS API Server Running');
    console.log('');
    console.log(`Server listening on: http://localhost:${PORT}`);
    console.log(`SMS endpoint: http://localhost:${PORT}/sms`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log('');
    console.log('To use in your .env file:');
    console.log(`DIALOGI_API_URL=http://localhost:${PORT}/sms`);
    console.log('');
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
