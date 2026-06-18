// This file contains code that we reuse between our tests.

import assert from 'node:assert';
import crypto from 'node:crypto';
import type * as test from 'node:test';
import type { ObjectId } from '@fastify/mongodb';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Collection } from 'mongodb';
import app from '../src/app.ts';
import { SubscriptionStatus } from '../src/types/subscription.ts';

export type TestContext = {
  after: typeof test.after;
};

process.env.HAKUVAHTI_API_KEY = 'test';

// Fill in this config with all the configurations
// needed for testing the application
function config() {
  return {};
}

/**
 * Helper for creating subscription in the database.
 *
 * @param collection - MongoDB collection to insert into
 * @param subscriptionData - Optional partial subscription data to override defaults
 * @returns The ObjectId of the created subscription
 */
export async function createSubscription(
  collection: Collection | undefined,
  subscriptionData: Partial<{
    hash: string;
    status: SubscriptionStatus;
    site_id: string;
    email: string;
    elastic_query: string;
    query: string;
    [key: string]: unknown;
  }> = {},
): Promise<ObjectId> {
  const insertResult = await collection?.insertOne({
    hash: crypto.randomUUID(),
    status: SubscriptionStatus.INACTIVE,
    site_id: 'test',
    email: 'test-atv-doc-id',
    atv_id: 'test-atv-doc-id',
    elastic_query: 'test-query',
    query: '/search?q=test',
    ...subscriptionData, // Override defaults with provided data
  });

  assert.ok(insertResult);

  return insertResult.insertedId;
}

// Automatically build and tear down our instance
async function build(t: TestContext): Promise<FastifyInstance> {
  const server = Fastify({ logger: { level: 'fatal' } });

  // Wrapping the app in fastify-plugin breaks encapsulation so that all
  // decorators are exposed for testing purposes; this is different from the
  // production setup, where the app is registered as its own context.
  // https://fastify.dev/docs/latest/Reference/Encapsulation/
  server.register(fp(app), config());

  // Tear down our app after we are done
  t.after(() => void server.close());

  await server.ready();

  return server;
}

export { config, build };
