import { checksumAddress, getAddress } from 'viem';
import { FORMATS_HEX_ADDRESS_PATTERN, FORMATS_HEX_BYTES32_PATTERN, FORMATS_HEX_BYTES_PATTERN, FORMATS_SAFE_INTEGER_BITS } from '../constants';
import type { Address, Hex } from '../interfaces';

/** Refuses anything but whole bytes as 0x-prefixed hex, since an odd digit count would be padded into other bytes. */
export function assertBytes(value: unknown, name: string): asserts value is Hex {
  if (typeof value !== 'string' || !FORMATS_HEX_BYTES_PATTERN.test(value)) {
    throw new TypeError(`${name} must be 0x-prefixed hex of whole bytes`);
  }
}

/** Refuses anything but exactly 32 bytes as 0x-prefixed hex. */
export function assertBytes32(value: unknown, name: string): asserts value is Hex {
  if (typeof value !== 'string' || !FORMATS_HEX_BYTES32_PATTERN.test(value)) {
    throw new TypeError(`${name} must be exactly 32 bytes of 0x-prefixed hex`);
  }
}

/** Whether the hex digits mix lower- and upper-case letters, the only spelling that claims an EIP-55 checksum. */
function hasMixedCase(value: string): boolean {
  const digits = value.slice(2);

  return digits !== digits.toLowerCase() && digits !== digits.toUpperCase();
}

/** Refuses anything but 20 bytes of 0x-prefixed hex, and a mixed-case address whose EIP-55 checksum fails. */
export function assertAddress(value: unknown, name: string): asserts value is Address {
  if (
    typeof value !== 'string' ||
    !FORMATS_HEX_ADDRESS_PATTERN.test(value) ||
    (hasMixedCase(value) && checksumAddress(value as Address) !== value)
  ) {
    throw new TypeError(`${name} must be a 20-byte address`);
  }
}

/** Refuses what `assertAddress` refuses and returns the accepted address in its EIP-55 checksummed spelling. */
export function normalizeAddress(value: unknown, name: string): Address {
  assertAddress(value, name);

  return getAddress(value);
}

/** Refuses null, undefined and any other non-object before a member of it is read. */
export function assertObject(value: unknown, name: string): asserts value is object {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`${name} must be an object`);
  }
}

/** Refuses anything but a boolean. */
export function assertBool(value: unknown, name: string): asserts value is boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${name} must be a boolean`);
  }
}

/** Refuses a non-integer with a `TypeError`, and a value outside [0, 2^bits) or the safe-integer range with a `RangeError`. */
export function assertUintNumber(value: unknown, bits: number, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer`);
  }

  if (value < 0 || !Number.isSafeInteger(value) || (bits < FORMATS_SAFE_INTEGER_BITS && value >= 2 ** bits)) {
    throw new RangeError(`${name} ${value} does not fit uint${bits} as a safe integer`);
  }
}

/** Refuses a non-bigint with a `TypeError`, and a value outside [0, 2^bits) with a `RangeError`. */
export function assertUintBigint(value: unknown, bits: number, name: string): asserts value is bigint {
  if (typeof value !== 'bigint') {
    throw new TypeError(`${name} must be a bigint`);
  }

  if (value < 0n || value >= 1n << BigInt(bits)) {
    throw new RangeError(`${name} ${value} does not fit uint${bits}`);
  }
}
