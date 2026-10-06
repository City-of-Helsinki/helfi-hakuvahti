// Loaded before every test file (see the test scripts in package.json).
//
// Tests empty whole collections, so they get a database of their own and refuse
// to run against anything but a local test database: MONGODB may point to the
// shared Cosmos DB.

const LOCAL_HOSTS = new Set(['mongodb', 'localhost', '127.0.0.1']);

const testDatabase = new URL(process.env.MONGODB_TEST ?? 'mongodb://mongodb:27017/hakuvahti_test');
const databaseName = testDatabase.pathname.replace(/^\//, '');

if (testDatabase.protocol !== 'mongodb:' || !LOCAL_HOSTS.has(testDatabase.hostname) || !databaseName.endsWith('_test')) {
  throw new Error(
    `Refusing to run tests against ${testDatabase.protocol}//${testDatabase.host}/${databaseName}: ` +
      'MONGODB_TEST must be a local database whose name ends in _test.',
  );
}

process.env.MONGODB = testDatabase.toString();
