import { FORMATS_HEX_BYTES32_PATTERN } from '../constants';
import type { Hex, PinnedBlock } from '../interfaces';

/** The block's number and lower-cased hash, throwing a `TypeError` unless it is an object with a safe non-negative number and a 32-byte hash. */
export function pinnedBlock(block: unknown, name: string): PinnedBlock {
  if (typeof block !== 'object' || block === null) throw new TypeError(`${name} must be an object`);

  const { number, hash } = block as Partial<Record<keyof PinnedBlock, unknown>>;

  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${name}.number must be a non-negative safe integer`);
  }

  if (typeof hash !== 'string' || !FORMATS_HEX_BYTES32_PATTERN.test(hash)) {
    throw new TypeError(`${name}.hash must be exactly 32 bytes of 0x-prefixed hex`);
  }

  return { number, hash: hash.toLowerCase() as Hex };
}
