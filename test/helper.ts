// This file contains code that we reuse between our tests.

import assert from 'node:assert';
import crypto from 'node:crypto';
import * as path from 'node:path';
import type * as test from 'node:test';
import type { ObjectId } from '@fastify/mongodb';
import type { FastifyInstance } from 'fastify';
import helper from 'fastify-cli/helper.js';
import type { Collection } from 'mongodb';
import { SubscriptionStatus } from '../src/types/subscription';

export type TestContext = {
  after: typeof test.after;
};

const AppPath = path.join(__dirname, '..', 'src', 'app.ts');

// Fill in this config with all the configurations
// needed for testing the application
function config() {
  return {
    // Fastify only exposes plugins to child context.
    // Fastify cli helper overrides this when skipOverride
    // option is set.
    // https://fastify.dev/docs/latest/Reference/Encapsulation/
    skipOverride: true, // Register our application with fastify-plugin
  };
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
    elastic_query: 'test-query',
    query: '/search?q=test',
    ...subscriptionData, // Override defaults with provided data
  });

  assert.ok(insertResult);

  return insertResult.insertedId;
}

// Automatically build and tear down our instance
async function build(t: TestContext): Promise<FastifyInstance> {
  // you can set all the options supported by the fastify CLI command
  const argv = [AppPath];

  // fastify-plugin ensures that all decorators
  // are exposed for testing purposes, this is
  // different from the production setup
  const app = await helper.build(argv, config());

  // Tear down our app after we are done
  t.after(() => void app.close());

  await app.ready();

  return app;
}

export { config, build };
