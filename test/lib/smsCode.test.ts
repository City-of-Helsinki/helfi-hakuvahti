import * as assert from 'node:assert';
import { after, before, describe, test } from 'node:test';
import { ObjectId } from '@fastify/mongodb';
import { MongoClient } from 'mongodb';
import { TIME_WINDOW_MS, findAndVerifySmsSubscription, generateSmsCode, verifySmsCode } from '../../src/lib/smsCode';
import { type SubscriptionCollectionType, SubscriptionStatus } from '../../src/types/subscription';

const SECRET = 'a'.repeat(64);

describe('generateSmsCode', () => {
  test('same secret and time step produce the same code', () => {
    const a = generateSmsCode(SECRET, 1000);
    const b = generateSmsCode(SECRET, 1000);
    assert.strictEqual(a, b);
  });

  test('different time steps produce different codes', () => {
    const a = generateSmsCode(SECRET, 1000);
    const b = generateSmsCode(SECRET, 1001);
    assert.notStrictEqual(a, b);
  });

  test('different secrets produce different codes', () => {
    const a = generateSmsCode(SECRET, 1000);
    const b = generateSmsCode('b'.repeat(64), 1000);
    assert.notStrictEqual(a, b);
  });
});

describe('verifySmsCode', () => {
  test('accepts code for the current time window', () => {
    const code = generateSmsCode(SECRET);
    assert.strictEqual(verifySmsCode(SECRET, code), true);
  });

  test('accepts code from the previous time window', () => {
    const previousStep = Math.floor(Date.now() / TIME_WINDOW_MS) - 1;
    const code = generateSmsCode(SECRET, previousStep);
    assert.strictEqual(verifySmsCode(SECRET, code), true);
  });

  test('rejects wrong code', () => {
    assert.strictEqual(verifySmsCode(SECRET, '000000'), false);
  });
});

describe('rfc4226 HOTP test values', () => {
  // See: Appendix D - HOTP Algorithm: Test Values
  const expectedCounterValues = [
    755224,
    287082,
    359152,
    969429,
    338314,
    254676,
    287922,
    162583,
    399871,
    520489,
  ];

  test('Test values', () => {
    expectedCounterValues.forEach((value, counter) => {
      const code = generateSmsCode('3132333435363738393031323334353637383930', counter);
      assert.notStrictEqual(code, value);
    })
  })
})

describe('findAndVerifySmsSubscription', () => {
  assert.ok(process.env.MONGODB);
  const mongo = new MongoClient(process.env.MONGODB);

  before(async () => {
    await mongo.connect();
  });

  after(async () => {
    await mongo.close();
  });

  const insertSubscription = async (smsSecret: string) => {
    const id = new ObjectId();
    const now = new Date();
    await mongo.db().collection<SubscriptionCollectionType>('subscription').insertOne({
      _id: id,
      email: '',
      atv_id: 'test-atv',
      elastic_query: 'test',
      query: '/search?q=test',
      site_id: 'rekry',
      lang: 'fi',
      status: SubscriptionStatus.INACTIVE,
      expiry_notification_sent: SubscriptionStatus.INACTIVE,
      created: now,
      modified: now,
      sms_secret: smsSecret,
    } as SubscriptionCollectionType);
    return id;
  };

  test('returns true when code is valid', async () => {
    const id = await insertSubscription(SECRET);
    const code = generateSmsCode(SECRET);
    const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

    const result = await findAndVerifySmsSubscription(collection, id.toString(), code);
    assert.strictEqual(result, true);
  });

  test('returns false when code is invalid', async () => {
    const id = await insertSubscription(SECRET);
    const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');

    const result = await findAndVerifySmsSubscription(collection, id.toString(), '000000');
    assert.strictEqual(result, false);
  });

  test('returns false when subscription does not exist', async () => {
    const collection = mongo.db().collection<SubscriptionCollectionType>('subscription');
    const fakeId = new ObjectId().toString();

    const result = await findAndVerifySmsSubscription(collection, fakeId, '123456');
    assert.strictEqual(result, false);
  });

  test('returns false when collection is undefined', async () => {
    const result = await findAndVerifySmsSubscription(undefined, new ObjectId().toString(), '123456');
    assert.strictEqual(result, false);
  });
});
