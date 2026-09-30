import { decodeFunctionData, encodeFunctionData } from 'viem';
import {
  FORMATS_ATTEMPT_ID_BITS,
  FORMATS_CANCEL_BY_PROOFS_ABI,
  FORMATS_CANCEL_BY_PROOFS_SELECTOR,
  FORMATS_SETUP_NONCE_BITS,
  FORMATS_START_ATTEMPT_ABI,
  FORMATS_START_ATTEMPT_SELECTOR,
  FORMATS_VALID_UNTIL_BITS,
} from '../constants';
import type { AttemptRequest, CancelRequest, Hex } from '../interfaces';
import { assertBytes, assertObject, assertUintBigint, assertUintNumber, normalizeAddress } from './guards';
import { checkedPaymentOrder } from './payment-order';
import { fromAbiProofPlaces, sortedProofPlaces, toAbiProofPlace } from './proof-place';
import { decodeStrictly } from './strict';

/** The checked members both requests share, addresses checksummed and proofs sorted by place. */
function checkedCancelRequest(request: CancelRequest): CancelRequest {
  assertObject(request, 'request');

  const account = normalizeAddress(request.account, 'account');
  const action = normalizeAddress(request.action, 'action');

  assertUintBigint(request.attemptId, FORMATS_ATTEMPT_ID_BITS, 'attemptId');
  assertUintBigint(request.setupNonce, FORMATS_SETUP_NONCE_BITS, 'setupNonce');
  assertBytes(request.setupBody, 'setupBody');
  assertUintNumber(request.validUntil, FORMATS_VALID_UNTIL_BITS, 'validUntil');

  return {
    account,
    action,
    attemptId: request.attemptId,
    setupNonce: request.setupNonce,
    setupBody: request.setupBody,
    validUntil: request.validUntil,
    proofs: sortedProofPlaces(request.proofs),
  };
}

/** Refuses calldata that does not open with the expected selector. */
function assertSelector(calldata: Hex, selector: Hex, functionName: string): void {
  assertBytes(calldata, 'calldata');

  if (calldata.slice(0, selector.length).toLowerCase() !== selector) {
    throw new RangeError(`calldata does not open with the ${functionName} selector ${selector}`);
  }
}

/**
 * Encodes `startAttempt(request)` calldata, throwing on a member outside its width.
 * Proofs are encoded sorted by place, a repeated place throws a `RangeError`, and an empty proof array is accepted.
 */
export function encodeAttemptRequest(request: AttemptRequest): Hex {
  const shared = checkedCancelRequest(request);

  assertBytes(request.payload, 'payload');

  const order = checkedPaymentOrder(request.order, 'order');

  return encodeFunctionData({
    abi: FORMATS_START_ATTEMPT_ABI,
    functionName: 'startAttempt',
    args: [
      {
        account: shared.account,
        action: shared.action,
        attemptId: shared.attemptId,
        setupNonce: shared.setupNonce,
        setupBody: shared.setupBody,
        payload: request.payload,
        order,
        validUntil: shared.validUntil,
        proofs: shared.proofs.map(toAbiProofPlace),
      },
    ],
  });
}

/**
 * Encodes `cancelByProofs(request)` calldata, throwing on a member outside its width.
 * Proofs are encoded sorted by place, a repeated place throws a `RangeError`, and an empty proof array is accepted.
 */
export function encodeCancelRequest(request: CancelRequest): Hex {
  const checked = checkedCancelRequest(request);

  return encodeFunctionData({
    abi: FORMATS_CANCEL_BY_PROOFS_ABI,
    functionName: 'cancelByProofs',
    args: [{ ...checked, proofs: checked.proofs.map(toAbiProofPlace) }],
  });
}

/**
 * Decodes `startAttempt` calldata, refusing a wrong selector, trailing or non-canonical bytes,
 * and proofs whose places are not strictly increasing, so a decoded request re-encodes to its input.
 */
export function decodeAttemptRequest(calldata: Hex): AttemptRequest {
  assertSelector(calldata, FORMATS_START_ATTEMPT_SELECTOR, 'startAttempt');

  return decodeStrictly(calldata, 'calldata', 'startAttempt(AttemptRequest)', {
    decode: (bytes) => decodeFunctionData({ abi: FORMATS_START_ATTEMPT_ABI, data: bytes }).args[0],
    build: (raw) => ({ ...raw, order: { ...raw.order }, proofs: fromAbiProofPlaces(raw.proofs) }),
    encode: encodeAttemptRequest,
  });
}

/**
 * Decodes `cancelByProofs` calldata, refusing a wrong selector, trailing or non-canonical bytes,
 * and proofs whose places are not strictly increasing, so a decoded request re-encodes to its input.
 */
export function decodeCancelRequest(calldata: Hex): CancelRequest {
  assertSelector(calldata, FORMATS_CANCEL_BY_PROOFS_SELECTOR, 'cancelByProofs');

  return decodeStrictly(calldata, 'calldata', 'cancelByProofs(CancelRequest)', {
    decode: (bytes) => decodeFunctionData({ abi: FORMATS_CANCEL_BY_PROOFS_ABI, data: bytes }).args[0],
    build: (raw) => ({ ...raw, proofs: fromAbiProofPlaces(raw.proofs) }),
    encode: encodeCancelRequest,
  });
}
