import { describe, expect, it } from 'vitest';
import type { Address, Hex } from '../../src/index';
import { ProviderDouble } from './double';
import {
  ACCOUNT,
  ACTION,
  ACTION_BAD_CHECKSUM,
  METHOD,
  METHOD_BAD_CHECKSUM,
  OTHER,
  attemptRequestOf,
  callData,
  cancelRequestOf,
  lowerOf,
  partFor,
  SIGNATURES,
  upperOf,
  vectorRow,
} from './fixtures';

const UINT64_MAX = (1n << 64n) - 1n;
const COMMITMENT: Hex = `0x${'3b'.repeat(32)}`;
const COMMIT_PARAMS = [{ type: 'address' }, { type: 'bytes32' }, { type: 'uint64' }, { type: 'bytes' }, { type: 'bytes' }] as const;
const VETO_PARAMS = [{ type: 'address' }, { type: 'address' }, { type: 'uint64' }, { type: 'address' }] as const;
const VECTOR_ACCOUNT: Address = '0x1111111111111111111111111111111111111111';
const VECTOR_ACTION: Address = '0x2222222222222222222222222222222222222222';

/** A provider double whose block reads and calls are counted, so a refusal can be shown to read nothing. */
const fresh = (): ProviderDouble => new ProviderDouble();

describe('the uint64 widths of the nonce and the attempt id', () => {
  it.each([UINT64_MAX + 1n, -1n, 1n << 128n])('prepareCommitSetup refuses the nonce %s', async (nonce) => {
    await expect(partFor(fresh()).prepareCommitSetup(ACTION, COMMITMENT, nonce, '0x', '0x')).rejects.toThrow();
  });

  it('prepareCommitSetup accepts the nonces 0 and 2^64 - 1', async () => {
    for (const nonce of [0n, UINT64_MAX]) {
      const call = await partFor(fresh()).prepareCommitSetup(ACTION, COMMITMENT, nonce, '0x', '0x');

      expect(call.data).toBe(callData(SIGNATURES.commitSetup, COMMIT_PARAMS, [ACTION, COMMITMENT, nonce, '0x', '0x']));
    }
  });

  it.each([UINT64_MAX + 1n, -1n])('prepareCancelByVeto refuses the attempt id %s', async (attemptId) => {
    await expect(partFor(fresh()).prepareCancelByVeto(ACCOUNT, ACTION, attemptId, METHOD)).rejects.toThrow();
  });

  it('prepareCancelByVeto accepts the attempt id 2^64 - 1', async () => {
    const call = await partFor(fresh()).prepareCancelByVeto(ACCOUNT, ACTION, UINT64_MAX, METHOD);

    expect(call.data).toBe(callData(SIGNATURES.cancelByVeto, VETO_PARAMS, [ACCOUNT, ACTION, UINT64_MAX, METHOD]));
  });
});

describe('the address rule on every address argument', () => {
  it('refuses a mixed-case action whose checksum is wrong', async () => {
    await expect(partFor(fresh()).prepareClearSetup(ACTION_BAD_CHECKSUM)).rejects.toThrow();
    await expect(partFor(fresh()).prepareCancelByOwner(ACTION_BAD_CHECKSUM)).rejects.toThrow();
  });

  it('refuses a mixed-case method whose checksum is wrong on the veto', async () => {
    await expect(partFor(fresh()).prepareCancelByVeto(ACCOUNT, ACTION, 1n, METHOD_BAD_CHECKSUM)).rejects.toThrow();
  });

  it.each([
    ['all lower case', lowerOf],
    ['all upper case', upperOf],
  ] as const)('accepts the bound action and a method spelled %s and encodes the same bytes', async (_spelling, spell) => {
    const expected = callData(SIGNATURES.cancelByVeto, VETO_PARAMS, [ACCOUNT, ACTION, 3n, METHOD]);

    expect((await partFor(fresh()).prepareCancelByVeto(spell(ACCOUNT), spell(ACTION), 3n, spell(METHOD))).data).toBe(expected);
    expect((await partFor(fresh()).prepareClearSetup(spell(ACTION))).data).toBe(callData(SIGNATURES.clearSetup, [{ type: 'address' }], [ACTION]));
  });

  it('accepts the bound pair given to the constructor in any accepted spelling', async () => {
    const call = await partFor(fresh(), upperOf(ACCOUNT), lowerOf(ACTION)).prepareCancelByVeto(ACCOUNT, ACTION, 3n, METHOD);

    expect(call.data).toBe(callData(SIGNATURES.cancelByVeto, VETO_PARAMS, [ACCOUNT, ACTION, 3n, METHOD]));
  });

  it('refuses a constructor address whose checksum is wrong', () => {
    expect(() => partFor(fresh(), ACCOUNT, ACTION_BAD_CHECKSUM)).toThrow();
  });
});

describe('the hex arguments of commitSetup', () => {
  it('lower-cases an upper-case commitment and upper-case metadata in the calldata', async () => {
    const upper: Hex = `0x${'AB'.repeat(32)}`;
    const call = await partFor(fresh()).prepareCommitSetup(ACTION, upper, 2n, '0xDEADBEEF', '0xCAFE');

    expect(call.data).toBe(callData(SIGNATURES.commitSetup, COMMIT_PARAMS, [ACTION, upper.toLowerCase(), 2n, '0xdeadbeef', '0xcafe']));
    expect(call.data).toBe(call.data.toLowerCase());
  });

  it.each([
    ['a 31-byte commitment', `0x${'ab'.repeat(31)}`, '0x', '0x'],
    ['a commitment that is not hex', `0x${'zz'.repeat(32)}`, '0x', '0x'],
    ['odd-length public metadata', `0x${'ab'.repeat(32)}`, '0x123', '0x'],
    ['private metadata without its 0x', `0x${'ab'.repeat(32)}`, '0x', 'beef'],
  ] as const)('refuses %s', async (_case, commitment, publicMetadata, privateMetadata) => {
    await expect(
      partFor(fresh()).prepareCommitSetup(ACTION, commitment as Hex, 1n, publicMetadata as Hex, privateMetadata as Hex),
    ).rejects.toThrow();
  });
});

describe('the bound account and action', () => {
  it.each([
    ['prepareCommitSetup', (part: ReturnType<typeof partFor>) => part.prepareCommitSetup(OTHER, COMMITMENT, 1n, '0x', '0x')],
    ['prepareClearSetup', (part: ReturnType<typeof partFor>) => part.prepareClearSetup(OTHER)],
    ['prepareCancelByOwner', (part: ReturnType<typeof partFor>) => part.prepareCancelByOwner(OTHER)],
    ['prepareCancelByVeto', (part: ReturnType<typeof partFor>) => part.prepareCancelByVeto(ACCOUNT, OTHER, 1n, METHOD)],
  ] as const)('%s throws a TypeError naming the action when it is not the bound one', async (_member, prepare) => {
    const provider = fresh();

    await expect(prepare(partFor(provider))).rejects.toThrow(TypeError);
    await expect(prepare(partFor(provider))).rejects.toThrow(/action/);
    expect(provider.blockTags).toEqual([]);
  });

  it('prepareCancelByVeto throws a TypeError naming the account when it is not the bound one', async () => {
    const provider = fresh();

    await expect(partFor(provider).prepareCancelByVeto(OTHER, ACTION, 1n, METHOD)).rejects.toThrow(TypeError);
    await expect(partFor(provider).prepareCancelByVeto(OTHER, ACTION, 1n, METHOD)).rejects.toThrow(/account/);
    expect(provider.blockTags).toEqual([]);
  });

  it('prepareStartAttempt and prepareCancelByProofs refuse a request for another account or action', async () => {
    const attempt = attemptRequestOf(vectorRow('attempt-request.json', 'sorted-proofs'));
    const cancel = cancelRequestOf(vectorRow('cancel-request.json', 'one-proof'));

    await expect(partFor(fresh(), VECTOR_ACCOUNT, VECTOR_ACTION).prepareStartAttempt({ ...attempt, account: OTHER })).rejects.toThrow(TypeError);
    await expect(partFor(fresh(), VECTOR_ACCOUNT, VECTOR_ACTION).prepareStartAttempt({ ...attempt, action: OTHER })).rejects.toThrow(TypeError);
    await expect(partFor(fresh(), VECTOR_ACCOUNT, VECTOR_ACTION).prepareCancelByProofs({ ...cancel, account: OTHER })).rejects.toThrow(TypeError);
    await expect(partFor(fresh(), VECTOR_ACCOUNT, VECTOR_ACTION).prepareCancelByProofs({ ...cancel, action: OTHER })).rejects.toThrow(TypeError);
  });
});
