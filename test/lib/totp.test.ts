import * as assert from 'node:assert';
import { describe, test } from 'node:test';
import { decodeBase32, generateTotp, hotp, verifyTotp } from '../../src/lib/totp.ts';

// RFC 4226 / RFC 6238 test secret: the ASCII string "12345678901234567890".
const RFC_SECRET = Buffer.from('12345678901234567890');
const RFC_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('decodeBase32', () => {
  test('decodes RFC 4648 test vectors', () => {
    // See: RFC 4648 section 10.
    const vectors: [string, string][] = [
      ['MY======', 'f'],
      ['MZXQ====', 'fo'],
      ['MZXW6===', 'foo'],
      ['MZXW6YQ=', 'foob'],
      ['MZXW6YTB', 'fooba'],
      ['MZXW6YTBOI======', 'foobar'],
      [RFC_SECRET_BASE32, '12345678901234567890'],
    ];

    for (const [encoded, expected] of vectors) {
      assert.strictEqual(decodeBase32(encoded).toString(), expected, `${encoded} should decode to ${expected}`);
    }
  });

  test('accepts the formats password managers display', () => {
    const expected = decodeBase32(RFC_SECRET_BASE32);

    assert.deepStrictEqual(decodeBase32(RFC_SECRET_BASE32.toLowerCase()), expected);
    assert.deepStrictEqual(decodeBase32('gezd gnbv gy3t qojq gezd gnbv gy3t qojq'), expected);
    assert.deepStrictEqual(decodeBase32('GEZDGNBV-GY3TQOJQ-GEZDGNBV-GY3TQOJQ'), expected);
  });

  test('rejects invalid secrets', () => {
    assert.throws(() => decodeBase32(''), /empty/);
    assert.throws(() => decodeBase32('   '), /empty/);
    // 0, 1 and 8 are not part of the base32 alphabet.
    assert.throws(() => decodeBase32('MZXW6YT1'), /Invalid base32 character/);
    assert.throws(() => decodeBase32('not base32!'), /Invalid base32 character/);
  });
});

describe('hotp', () => {
  test('matches RFC 4226 test values', () => {
    // See: RFC 4226 Appendix D - HOTP Algorithm: Test Values.
    const expectedCodes = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];

    expectedCodes.forEach((expected, counter) => {
      assert.strictEqual(hotp(RFC_SECRET, counter), expected, `counter ${counter}`);
    });
  });
});

describe('generateTotp', () => {
  test('matches RFC 6238 test values', () => {
    // See: RFC 6238 Appendix B - Test Vectors (SHA-1, truncated to 6 digits).
    const vectors: [number, string][] = [
      [1, '287082'], // T = 59
      [37037036, '081804'], // T = 1111111109
      [37037037, '050471'], // T = 1111111111
      [41152263, '005924'], // T = 1234567890
      [66666666, '279037'], // T = 2000000000
      [666666666, '353130'], // T = 20000000000
    ];

    for (const [step, expected] of vectors) {
      assert.strictEqual(generateTotp(RFC_SECRET, step), expected, `step ${step}`);
    }
  });
});

describe('verifyTotp', () => {
  const step = 41152263;

  test('accepts the current code', () => {
    assert.strictEqual(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, step), step), true);
  });

  test('accepts the previous and next step for clock skew', () => {
    assert.strictEqual(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, step - 1), step), true);
    assert.strictEqual(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, step + 1), step), true);
  });

  test('rejects codes outside the tolerance', () => {
    assert.strictEqual(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, step - 2), step), false);
    assert.strictEqual(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, step + 2), step), false);
  });

  test('rejects wrong and malformed codes', () => {
    assert.strictEqual(verifyTotp(RFC_SECRET, '000000', step), false);
    assert.strictEqual(verifyTotp(RFC_SECRET, '', step), false);
    assert.strictEqual(verifyTotp(RFC_SECRET, '5924', step), false);
    assert.strictEqual(verifyTotp(RFC_SECRET, '0059240', step), false);
  });

  test('rejects a code generated with a different secret', () => {
    const code = generateTotp(Buffer.from('09876543210987654321'), step);

    assert.strictEqual(verifyTotp(RFC_SECRET, code, step), false);
  });
});
