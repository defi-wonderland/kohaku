import {
  FORMATS_AMOUNT_BITS,
  FORMATS_ATTEMPT_ID_BITS,
  FORMATS_CHAIN_ID_BITS,
  FORMATS_SAFE_INTEGER_BITS,
  FORMATS_SETUP_NONCE_BITS,
  FORMATS_VALID_UNTIL_BITS,
  GATHERING_DECIMAL_PATTERN,
  GATHERING_KIND,
  GATHERING_UNREAD_RECORD_MESSAGE,
  GATHERING_VERSION,
} from '../constants';
import { setupBodyHash } from '../formats/commitments';
import { approvalDigest, cancellationDigest } from '../formats/digests';
import { assertUintBigint, assertUintNumber } from '../formats/guards';
import type { Gathering, Hex } from '../interfaces';
import type { WindowFacts } from '../types/validation';
import type { CancellationMembers, SetupBody } from '../types';

/** A record decimal string as a bigint, refusing another spelling and a value outside [0, 2^bits). */
export function decimalBigint(value: unknown, bits: number, name: string): bigint {
  if (typeof value !== 'string' || !GATHERING_DECIMAL_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a decimal string`);
  }

  const parsed = BigInt(value);

  assertUintBigint(parsed, bits, name);

  return parsed;
}

/** A record decimal string as a number, refusing what `decimalBigint` refuses and a value past the safe-integer range. */
export function decimalNumber(value: unknown, bits: number, name: string): number {
  const parsed = decimalBigint(value, Math.max(bits, FORMATS_SAFE_INTEGER_BITS), name);
  const converted = Number(parsed);

  assertUintNumber(converted, bits, name);

  return converted;
}

/** Throws where the record's kind or version is not the one this build reads. */
export function assertGatheringRead(record: Gathering): void {
  if (typeof record !== 'object' || record === null || record.kind !== GATHERING_KIND || record.version !== GATHERING_VERSION) {
    throw new TypeError(GATHERING_UNREAD_RECORD_MESSAGE);
  }
}

/** Each clause's threshold and places, a place being the flat index of a credential across the clauses in body order. */
export function clausePlaces(body: SetupBody): readonly { readonly threshold: number; readonly places: readonly number[] }[] {
  let next = 0;

  return body.clauses.map((clause) => ({ threshold: clause.threshold, places: clause.credentials.map(() => next++) }));
}

/** The members both digests share, converted from the record's decimal strings. */
function sharedMembers(record: Gathering): CancellationMembers {
  const { request } = record;

  return {
    chainId: decimalNumber(request.chainId, FORMATS_CHAIN_ID_BITS, 'chainId'),
    manager: request.manager,
    account: request.account,
    action: request.action,
    attemptId: decimalBigint(request.attemptId, FORMATS_ATTEMPT_ID_BITS, 'attemptId'),
    setupNonce: decimalBigint(request.setupNonce, FORMATS_SETUP_NONCE_BITS, 'setupNonce'),
    setupBodyHash: setupBodyHash(request.setupBody),
    validUntil: decimalNumber(request.validUntil, FORMATS_VALID_UNTIL_BITS, 'validUntil'),
  };
}

/** The digest this gathering's own members produce for one place; throws on a malformed member. */
export function digestFor(record: Gathering, place: number): Hex {
  const shared = sharedMembers(record);

  if (record.purpose === 'cancellation') {
    return cancellationDigest(shared, place);
  }

  const { order } = record.request;

  return approvalDigest(
    {
      ...shared,
      payload: record.request.payload,
      order: { token: order.token, amount: decimalBigint(order.amount, FORMATS_AMOUNT_BITS, 'order.amount'), payee: order.payee },
    },
    place,
  );
}

/** The record's window as the window findings read it. */
export function windowFactsOf(record: Gathering): WindowFacts {
  const validUntil = decimalNumber(record.request.validUntil, FORMATS_VALID_UNTIL_BITS, 'validUntil');
  const blockTimestamp = decimalNumber(record.request.block.timestamp, FORMATS_SAFE_INTEGER_BITS, 'block.timestamp');

  if (record.purpose === 'cancellation') {
    return {
      validUntil,
      blockTimestamp,
      consumableAfter: decimalNumber(record.request.consumableAfter, FORMATS_VALID_UNTIL_BITS, 'consumableAfter'),
    };
  }

  return { validUntil, blockTimestamp };
}
