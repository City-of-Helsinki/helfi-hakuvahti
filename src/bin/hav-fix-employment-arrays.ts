import dotenv from 'dotenv';
import fastify from 'fastify';
import mongodb from '../plugins/mongodb';

dotenv.config();

const server = fastify({});
void server.register(mongodb);

const DRY_RUN = process.argv.includes('--dry-run');

const FIELDS_TO_FIX = ['employment_id', 'employment_type_id', 'task_area_external_id'];

const fixCommaSeparatedArrays = (obj: any, path = ''): { fixed: any; modified: boolean; changedFields: string[] } => {
  const changedFields: string[] = [];
  let modified = false;

  const fixed = JSON.parse(JSON.stringify(obj), (key, value) => {
    const currentPath = path ? `${path}.${key}` : key;

    if (FIELDS_TO_FIX.includes(key) && Array.isArray(value) && value.length > 0) {
      const needsFix = value.some((v) => typeof v === 'string' && v.includes(','));

      if (needsFix) {
        modified = true;
        changedFields.push(currentPath);
        return value.flatMap((v) => (typeof v === 'string' && v.includes(',') ? v.split(',').map((s) => s.trim()) : v));
      }
    }
    return value;
  });

  return { fixed, modified, changedFields };
};

const app = async (): Promise<void> => {
  const db = server.mongo?.db;
  if (!db) {
    throw new Error('MongoDB connection not available');
  }

  const subscriptionsCollection = db.collection('subscriptions');

  console.log('Fixing comma-separated arrays in elastic queries');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Fields: ${FIELDS_TO_FIX.join(', ')}\n`);

  const subscriptions = await subscriptionsCollection.find({}).toArray();
  console.log(`Found ${subscriptions.length} subscriptions\n`);

  let fixedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const fixes: Array<{ id: string; fields: string[] }> = [];

  for (const subscription of subscriptions) {
    try {
      const originalQuery = subscription.elastic_query;
      const decoded = Buffer.from(originalQuery, 'base64').toString('utf-8');
      const queryObj = JSON.parse(decoded);

      const { fixed: fixedQuery, modified, changedFields } = fixCommaSeparatedArrays(queryObj);

      if (modified) {
        const fixedStr = JSON.stringify(fixedQuery);
        const newEncoded = Buffer.from(fixedStr).toString('base64');

        console.log(`${DRY_RUN ? '[DRY] ' : ''}Fixed ${subscription._id} (${subscription.email || 'N/A'})`);
        console.log(`  Fields: ${changedFields.join(', ')}`);
        console.log(`  Before: ${decoded.substring(0, 120)}...`);
        console.log(`  After:  ${fixedStr.substring(0, 120)}...\n`);

        fixes.push({
          id: subscription._id.toString(),
          fields: changedFields,
        });

        if (!DRY_RUN) {
          await subscriptionsCollection.updateOne({ _id: subscription._id }, { $set: { elastic_query: newEncoded } });
        }

        fixedCount++;
      } else {
        skippedCount++;
      }
    } catch (error) {
      console.error(`Error processing ${subscription._id}:`, error);
      errorCount++;
    }
  }

  console.log('\nSummary:');
  console.log(`  ${DRY_RUN ? 'Would fix' : 'Fixed'}: ${fixedCount}`);
  console.log(`  Skipped: ${skippedCount}`);
  console.log(`  Errors: ${errorCount}`);
  console.log(`  Total: ${subscriptions.length}`);

  if (fixes.length > 0) {
    console.log('\nFields fixed:');
    const fieldCounts = new Map<string, number>();
    fixes.forEach(({ fields }) => {
      fields.forEach((field) => {
        fieldCounts.set(field, (fieldCounts.get(field) || 0) + 1);
      });
    });

    fieldCounts.forEach((count, field) => {
      console.log(`  ${field}: ${count}`);
    });
  }

  if (DRY_RUN && fixedCount > 0) {
    console.log('\nRun without --dry-run to apply changes');
  }
};

server.get('/', async function handleRootRequest(_request, _reply) {
  await app();
  return { success: true };
});

server.ready((_err) => {
  console.log('fastify server ready');
  server.inject(
    {
      method: 'GET',
      url: '/',
    },
    function handleInjectResponse(_injectErr, response) {
      if (response) {
        console.log(JSON.parse(response.payload));
      }

      server.close();
    },
  );
});
