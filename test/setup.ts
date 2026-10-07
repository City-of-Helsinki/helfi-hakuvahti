// Loaded before every test file by the test scripts in package.json, and
// imported by the shared test helpers so running a single file is covered too.
//
// Tests empty whole collections, so they use their own database and never
// MONGODB, which may point to the shared Cosmos DB.

if (!process.env.MONGODB_TEST) {
  throw new Error('MONGODB_TEST is not set: tests only run against their own database (see compose.yaml).');
}

process.env.MONGODB = process.env.MONGODB_TEST;
