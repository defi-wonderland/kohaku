import { decodeAbiParameters, decodeFunctionData, encodeFunctionData } from 'viem';
import {
  FORMATS_ATTEMPT_ID_BITS,
  FORMATS_CANCEL_BY_PROOFS_ABI,
  FORMATS_PLACE_BITS,
  FORMATS_PROOF_PLACE_ABI,
  FORMATS_SETUP_NONCE_BITS,
  FORMATS_START_ATTEMPT_ABI,
  POLICY_MANAGER_HASH_APPROVAL_ABI,
  POLICY_MANAGER_HASH_CANCEL_ABI,
  POLICY_MANAGER_WRITES_ABI,
} from '../constants';
import { encodeAttemptRequest, encodeCancelRequest, encodeProofPlace } from '../formats';
import { assertArray, assertBytes, assertBytes32, assertObject, assertUintBigint, assertUintNumber, normalizeAddress } from '../formats/guards';
import type { Address, AttemptRequest, CancelRequest, Hex, ProofPlace } from '../interfaces';

const lower = (value: Hex): Hex => value.toLowerCase() as Hex;

/** The address in its checksummed spelling; a `TypeError` naming the argument where it is not the address the part is bound to. */
export function boundAddress(value: unknown, bound: Address, name: string, role: string): Address {
  const normalized = normalizeAddress(value, name);

  if (normalized !== bound) throw new TypeError(`${name} ${normalized} is not the bound ${role} ${bound}`);

  return normalized;
}

/** Refuses a request whose account or action is not the bound pair. */
export function assertBoundRequest(request: CancelRequest, account: Address, action: Address): void {
  assertObject(request, 'request');
  boundAddress(request.account, account, 'request.account', 'account');
  boundAddress(request.action, action, 'request.action', 'action');
}

/** `commitSetup(action, setupCommitment, nonce, publicMetadata, privateMetadata)` calldata, every hex argument lower-cased. */
export function commitSetupData(action: Address, setupCommitment: Hex, nonce: bigint, publicMetadata: Hex, privateMetadata: Hex): Hex {
  assertBytes32(setupCommitment, 'setupCommitment');
  assertUintBigint(nonce, FORMATS_SETUP_NONCE_BITS, 'nonce');
  assertBytes(publicMetadata, 'publicMetadata');
  assertBytes(privateMetadata, 'privateMetadata');

  return encodeFunctionData({
    abi: POLICY_MANAGER_WRITES_ABI,
    functionName: 'commitSetup',
    args: [action, lower(setupCommitment), nonce, lower(publicMetadata), lower(privateMetadata)],
  });
}

/** `clearSetup(action)` or `cancelByOwner(action)` calldata. */
export const ownerCallData = (functionName: 'clearSetup' | 'cancelByOwner', action: Address): Hex =>
  encodeFunctionData({ abi: POLICY_MANAGER_WRITES_ABI, functionName, args: [action] });

/** `cancelByVeto(account, action, attemptId, method)` calldata. */
export function cancelByVetoData(account: Address, action: Address, attemptId: bigint, method: unknown): Hex {
  assertUintBigint(attemptId, FORMATS_ATTEMPT_ID_BITS, 'attemptId');

  return encodeFunctionData({
    abi: POLICY_MANAGER_WRITES_ABI,
    functionName: 'cancelByVeto',
    args: [account, action, attemptId, normalizeAddress(method, 'method')],
  });
}

/**
 * The proofs in the order given, each checked and normalized by the proof place codec;
 * the submission-only rules, sorting and strictly increasing places, are not applied.
 */
function proofsAsGiven(proofs: readonly ProofPlace[]) {
  assertArray(proofs, 'request.proofs');

  return proofs.map((proof) => decodeAbiParameters(FORMATS_PROOF_PLACE_ABI, encodeProofPlace(proof))[0]);
}

/** `hashApproval(request, place)` calldata, every member checked by the `startAttempt` codec and the proofs kept in the order given. */
export function hashApprovalData(request: AttemptRequest, place: number): Hex {
  assertObject(request, 'request');

  const { args } = decodeFunctionData({ abi: FORMATS_START_ATTEMPT_ABI, data: encodeAttemptRequest({ ...request, proofs: [] }) });
  const proofs = proofsAsGiven(request.proofs);

  assertUintNumber(place, FORMATS_PLACE_BITS, 'place');

  return encodeFunctionData({ abi: POLICY_MANAGER_HASH_APPROVAL_ABI, args: [{ ...args[0], proofs }, BigInt(place)] });
}

/** `hashCancel(request, place)` calldata, every member checked by the `cancelByProofs` codec and the proofs kept in the order given. */
export function hashCancelData(request: CancelRequest, place: number): Hex {
  assertObject(request, 'request');

  const { args } = decodeFunctionData({ abi: FORMATS_CANCEL_BY_PROOFS_ABI, data: encodeCancelRequest({ ...request, proofs: [] }) });
  const proofs = proofsAsGiven(request.proofs);

  assertUintNumber(place, FORMATS_PLACE_BITS, 'place');

  return encodeFunctionData({ abi: POLICY_MANAGER_HASH_CANCEL_ABI, args: [{ ...args[0], proofs }, BigInt(place)] });
}
