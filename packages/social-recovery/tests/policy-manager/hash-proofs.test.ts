import { describe, expect, it } from 'vitest';
import type { Address, AttemptRequest, CancelRequest, Hex, ProofPlace } from '../../src/index';
import { ProviderDouble, always } from './double';
import {
  ACTION_BAD_CHECKSUM,
  ATTEMPT_REQUEST_PARAM,
  CANCEL_REQUEST_PARAM,
  METHOD,
  attemptRequestOf,
  callData,
  cancelRequestOf,
  partFor,
  SIGNATURES,
  tupleOf,
  vectorRow,
} from './fixtures';

const VECTOR_ACCOUNT: Address = '0x1111111111111111111111111111111111111111';
const VECTOR_ACTION: Address = '0x2222222222222222222222222222222222222222';
const DIGEST: Hex = `0x${'5e'.repeat(32)}`;

/** One proof at a place, its bytes marked with the place so two proofs at one place still differ. */
const proofAt = (place: number, mark: number): ProofPlace => ({
  place,
  method: METHOD,
  config: `0x${mark.toString(16).padStart(4, '0')}`,
  salt: `0x${'aa'.repeat(32)}`,
  proof: `0xbeef${mark.toString(16).padStart(2, '0')}`,
});

const attempt = (proofs: readonly ProofPlace[]): AttemptRequest => ({ ...attemptRequestOf(vectorRow('attempt-request.json', 'sorted-proofs')), proofs });
const cancel = (proofs: readonly ProofPlace[]): CancelRequest => ({ ...cancelRequestOf(vectorRow('cancel-request.json', 'one-proof')), proofs });

const approvalData = (request: AttemptRequest, place: bigint): Hex =>
  callData(SIGNATURES.hashApproval, [ATTEMPT_REQUEST_PARAM, { type: 'uint256' }], [tupleOf(request), place]);
const cancelData = (request: CancelRequest, place: bigint): Hex =>
  callData(SIGNATURES.hashCancel, [CANCEL_REQUEST_PARAM, { type: 'uint256' }], [tupleOf(request), place]);

const PROOF_SETS = [
  ['unsorted places [2, 0], kept in that order', [proofAt(2, 1), proofAt(0, 2)]],
  ['the repeated places [0, 0]', [proofAt(0, 1), proofAt(0, 2)]],
  ['an empty proof array', []],
  ['descending places [5, 3, 1]', [proofAt(5, 1), proofAt(3, 2), proofAt(1, 3)]],
] as const;

describe('the hash reads carry the proofs as given', () => {
  it.each(PROOF_SETS)('hashApproval sends %s and makes the read', async (_case, proofs) => {
    const provider = always({ returns: DIGEST });
    const request = attempt(proofs);

    expect(await partFor(provider, VECTOR_ACCOUNT, VECTOR_ACTION).hashApproval(request, 2)).toBe(DIGEST);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.data).toBe(approvalData(request, 2n));
  });

  it.each(PROOF_SETS)('hashCancel sends %s and makes the read', async (_case, proofs) => {
    const provider = always({ returns: DIGEST });
    const request = cancel(proofs);

    expect(await partFor(provider, VECTOR_ACCOUNT, VECTOR_ACTION).hashCancel(request, 0)).toBe(DIGEST);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.data).toBe(cancelData(request, 0n));
  });

  it('checksums lower-case and upper-case proof methods and lower-cases upper-case proof bytes', async () => {
    const provider = always({ returns: DIGEST });
    const given: ProofPlace = { ...proofAt(4, 9), method: METHOD.toUpperCase().replace('0X', '0x') as Address, config: '0xABCD', proof: '0xBEEF' };
    const expected: ProofPlace = { ...given, method: METHOD, config: '0xabcd', proof: '0xbeef' };

    await partFor(provider, VECTOR_ACCOUNT, VECTOR_ACTION).hashApproval(attempt([given, proofAt(1, 1)]), 0);

    expect(provider.calls[0]?.data).toBe(approvalData(attempt([expected, proofAt(1, 1)]), 0n));
  });
});

describe('the prepares keep the submission rules', () => {
  it('prepareStartAttempt and prepareCancelByProofs sort unsorted proofs by place', async () => {
    const unsorted = [proofAt(2, 1), proofAt(0, 2)];
    const sorted = [proofAt(0, 2), proofAt(2, 1)];
    const part = partFor(new ProviderDouble(), VECTOR_ACCOUNT, VECTOR_ACTION);

    expect((await part.prepareStartAttempt(attempt(unsorted))).data).toBe(
      callData(SIGNATURES.startAttempt, [ATTEMPT_REQUEST_PARAM], [tupleOf(attempt(sorted))]),
    );
    expect((await part.prepareCancelByProofs(cancel(unsorted))).data).toBe(
      callData(SIGNATURES.cancelByProofs, [CANCEL_REQUEST_PARAM], [tupleOf(cancel(sorted))]),
    );
  });

  it('prepareStartAttempt and prepareCancelByProofs refuse a repeated place', async () => {
    const repeated = [proofAt(0, 1), proofAt(0, 2)];
    const part = partFor(new ProviderDouble(), VECTOR_ACCOUNT, VECTOR_ACTION);

    await expect(part.prepareStartAttempt(attempt(repeated))).rejects.toThrow();
    await expect(part.prepareCancelByProofs(cancel(repeated))).rejects.toThrow();
  });
});

describe('the member guards on the hash path', () => {
  const badCases = [
    ['a proof method whose checksum is wrong', { proofs: [{ ...proofAt(0, 1), method: '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9adb' }] }],
    ['an order token whose checksum is wrong', 'order'],
    ['an attempt id of 2^64', { attemptId: 1n << 64n }],
    ['a setup nonce of 2^64', { setupNonce: 1n << 64n }],
    ['a setup body that is not hex', { setupBody: '0xzz' }],
    ['a proof salt of 31 bytes', { proofs: [{ ...proofAt(0, 1), salt: `0x${'aa'.repeat(31)}` }] }],
    ['a negative proof place', { proofs: [proofAt(-1, 1)] }],
    ['proofs that are not an array', { proofs: 'none' }],
    ['a proof that is null', { proofs: [proofAt(0, 1), null] }],
  ] as const;

  /** The bad member applied to a request of either kind. */
  const spoil = <Request extends CancelRequest>(request: Request, change: (typeof badCases)[number][1]): Request =>
    (change === 'order'
      ? { ...request, order: { token: ACTION_BAD_CHECKSUM, amount: 1n, payee: METHOD } }
      : { ...request, ...change }) as Request;

  it.each(badCases)('hashApproval throws on %s before any read', async (_case, change) => {
    const provider = always({ returns: DIGEST });

    await expect(partFor(provider, VECTOR_ACCOUNT, VECTOR_ACTION).hashApproval(spoil(attempt([]), change), 0)).rejects.toThrow();
    expect(provider.calls).toEqual([]);
  });

  it('hashApproval throws on a payload that is not hex before any read', async () => {
    const provider = always({ returns: DIGEST });

    await expect(partFor(provider, VECTOR_ACCOUNT, VECTOR_ACTION).hashApproval({ ...attempt([]), payload: 'abcd' as Hex }, 0)).rejects.toThrow();
    expect(provider.calls).toEqual([]);
  });

  it.each(badCases.filter(([, change]) => change !== 'order'))('hashCancel throws on %s before any read', async (_case, change) => {
    const provider = always({ returns: DIGEST });

    await expect(partFor(provider, VECTOR_ACCOUNT, VECTOR_ACTION).hashCancel(spoil(cancel([]), change), 0)).rejects.toThrow();
    expect(provider.calls).toEqual([]);
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])('both hash reads throw on the place %s before any read', async (place) => {
    const provider = always({ returns: DIGEST });
    const part = partFor(provider, VECTOR_ACCOUNT, VECTOR_ACTION);

    await expect(part.hashApproval(attempt([]), place)).rejects.toThrow();
    await expect(part.hashCancel(cancel([]), place)).rejects.toThrow();
    expect(provider.calls).toEqual([]);
  });
});
