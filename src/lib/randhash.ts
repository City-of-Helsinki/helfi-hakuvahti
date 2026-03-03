import { randomBytes } from 'node:crypto';

export function getRandHash(): string {
  const bytes = randomBytes(8);

  return BigInt(`0x${bytes.toString('hex')}`)
    .toString(36)
    .padStart(11, '0')
    .substring(0, 11);
}
