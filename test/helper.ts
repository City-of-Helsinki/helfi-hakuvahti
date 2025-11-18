// This file contains code that we reuse between our tests.
import helper from 'fastify-cli/helper.js';
import * as path from 'node:path'
import * as test from 'node:test'
import {FastifyInstance} from "fastify";
import type {Collection} from "mongodb";
import {ObjectId} from "@fastify/mongodb";
import {SubscriptionStatus} from "../src/types/subscription";
import assert from "node:assert";

export type TestContext = {
  after: typeof test.after
};

const AppPath = path.join(__dirname, '..', 'src', 'app.ts')

// Fill in this config with all the configurations
// needed for testing the application
function config () {
  return {
    // Fastify only exposes plugins to child context.
    // Fastify cli helper overrides this when skipOverride
    // option is set.
    // https://fastify.dev/docs/latest/Reference/Encapsulation/
    skipOverride: true // Register our application with fastify-plugin
  }
}

/**
 * Helper for creating subscription in the database.
 */
export async function createSubscription(collection: Collection | undefined, hash = `test-hash-${Date.now()}`): Promise<ObjectId> {
  const testSubscription = {
    hash,
    status: SubscriptionStatus.INACTIVE,
    site_id: 'test',
    email: 'test-atv-doc-id',
    elastic_query: 'test-query',
    query: '/search?q=test',
  };

  const insertResult = await collection?.insertOne(testSubscription);

  assert.ok(insertResult)

  return insertResult.insertedId;
}

// Automatically build and tear down our instance
async function build (t: TestContext): Promise<FastifyInstance> {
  // you can set all the options supported by the fastify CLI command
  const argv = [AppPath]

  // fastify-plugin ensures that all decorators
  // are exposed for testing purposes, this is
  // different from the production setup
  const app = await helper.build(argv, config())

  // Tear down our app after we are done
  t.after(() => void app.close())

  await app.ready()

  return app
}

export {
  config,
  build
}
