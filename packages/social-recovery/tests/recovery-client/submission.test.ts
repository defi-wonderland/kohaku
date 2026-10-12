import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { decodeRevert, KitRefusalError, type Address, type AttemptRequest, type CancelRequest, type Hex, type PreparedCall } from '../../src/index';
import {
  ACCOUNT,
  ACTION,
  attemptIn,
  callsTo,
  CLIENT_CONFIGURATION,
  errorCodes,
  HEADER,
  INJECTED,
  KEY_NEW,
  lastArg,
  MANAGER,
  pinnedOf,
  rejectionOf,
  rig,
  stateFor,
  world,
  ZERO,
} from './doubles';
import { cancelByProofsData, payloadOf, startAttemptData } from './encodings';
import { attemptVector, boundAttempt, boundCancel, cancelVector, membersOf, VALIDATION_READS } from './prepare-fixtures';

const NOW = HEADER.timestamp;
const SPONSOR = getAddress(`0x${'5b'.repeat(20)}`);
const VECTOR_ACCOUNT = getAddress('0x1111111111111111111111111111111111111111');
const VECTOR_ACTION = getAddress('0x2222222222222222222222222222222222222222');

type Submit = {
  readonly name: string;
  readonly member: 'prepareStartAttempt' | 'prepareCancelByProofs';
  readonly request: () => AttemptRequest | CancelRequest;
  readonly data: (request: never) => Hex;
};

const SUBMITS: readonly Submit[] = [
  { name: 'prepareStartAttempt', member: 'prepareStartAttempt', request: boundAttempt, data: startAttemptData as (request: never) => Hex },
  { name: 'prepareCancelByProofs', member: 'prepareCancelByProofs', request: boundCancel, data: cancelByProofsData as (request: never) => Hex },
];

const submit = (built: ReturnType<typeof rig>, s: Submit, request: unknown, now: unknown = NOW, options?: unknown): Promise<PreparedCall> =>
  (built.client[s.member] as (r: unknown, n: unknown, o?: unknown) => Promise<PreparedCall>)(request, now, options);

describe('the pinned encodings stand on the blessed rows', () => {
  it('startAttempt over the attempt-request row is the row calldata', () => {
    const { request, calldata } = attemptVector();

    expect(startAttemptData(request)).toBe(calldata);
  });

  it('cancelByProofs over the cancel-request row is the row calldata', () => {
    const { request, calldata } = cancelVector();

    expect(cancelByProofsData(request)).toBe(calldata);
  });
});

describe('the blessed cancel row through prepareCancelByProofs', () => {
  it('prepares the row calldata byte for byte for a client bound to the row pair', async () => {
    const { request, calldata } = cancelVector();
    const built = rig(world(), CLIENT_CONFIGURATION, { account: VECTOR_ACCOUNT, action: VECTOR_ACTION });
    const prepared = await built.client.prepareCancelByProofs(request, NOW);

    expect(prepared.data.toLowerCase()).toBe(calldata.toLowerCase());
    expect(prepared.target.toLowerCase()).toBe(MANAGER.toLowerCase());
    expect(prepared.sender).toBe('anyone');
  });
});

describe.each(SUBMITS)('$name', (s) => {
  it('targets the manager, sent by anyone, value zero, the pinned block, the pinned bytes', async () => {
    const built = rig();
    const request = s.request();
    const prepared = await submit(built, s, request);

    expect(prepared.kind).toBe('call');
    expect(prepared.target.toLowerCase()).toBe(MANAGER.toLowerCase());
    expect(prepared.sender).toBe('anyone');
    expect(prepared.value).toBe(0n);
    expect(prepared.data.toLowerCase()).toBe(s.data(request as never).toLowerCase());
    expect(prepared.block).toEqual(pinnedOf(HEADER));
    expect(prepared.describes).toBeUndefined();
  });

  it('pins one block with the read tag and passes it to the part', async () => {
    const built = rig();

    await submit(built, s, s.request());

    expect(callsTo(built.seen, 'provider', 'block').map((one) => one.args)).toEqual([[CLIENT_CONFIGURATION.blockTags.read]]);

    const part = callsTo(built.seen, 'manager', s.member);

    expect(part).toHaveLength(1);
    expect(lastArg(part[0]!)).toEqual(pinnedOf(HEADER));
  });

  it('runs no request validation and makes no validation read', async () => {
    const built = rig();

    await submit(built, s, s.request(), NOW, { simulate: true });

    const made = membersOf(built.seen);

    expect(made.filter((member) => VALIDATION_READS.includes(member))).toEqual([]);
    expect(made).toEqual(['provider.block', `manager.${s.member}`, 'provider.call']);
  });

  it('prepares a request validation would refuse: expired, against an attempt-active state, rule unmet', async () => {
    const live = world({ state: stateFor(undefined, attemptIn('Waiting', 9n)) });
    const request = { ...s.request(), validUntil: 1, proofs: [] };
    const prepared = await submit(rig(live), s, request, HEADER.timestamp + 10_000_000);

    expect(prepared.data.toLowerCase()).toBe(s.data(request as never).toLowerCase());
  });

  it('refuses a request bound to another account with a TypeError before any provider call', async () => {
    const built = rig();
    const thrown = await rejectionOf(submit(built, s, { ...s.request(), account: KEY_NEW }));

    expect(thrown).toBeInstanceOf(TypeError);
    expect(built.seen).toEqual([]);
  });

  it('refuses a request bound to another action with a TypeError before any provider call', async () => {
    const built = rig();
    const thrown = await rejectionOf(submit(built, s, { ...s.request(), action: KEY_NEW }));

    expect(thrown).toBeInstanceOf(TypeError);
    expect(built.seen).toEqual([]);
  });

  it('accepts the bound pair in another spelling', async () => {
    const request = { ...s.request(), account: ACCOUNT.toLowerCase() as Address, action: ACTION.toLowerCase() as Address };

    await expect(submit(rig(), s, request)).resolves.toBeDefined();
  });

  it.each([
    ['no request', () => undefined],
    ['a string request', () => 'request'],
    ['a number attempt id', (r: Record<string, unknown>) => ({ ...r, attemptId: 9 })],
    ['a negative attempt id', (r: Record<string, unknown>) => ({ ...r, attemptId: -1n })],
    ['an attempt id over uint64', (r: Record<string, unknown>) => ({ ...r, attemptId: 2n ** 64n })],
    ['a malformed account', (r: Record<string, unknown>) => ({ ...r, account: '0x12' })],
    ['a non-hex setup body', (r: Record<string, unknown>) => ({ ...r, setupBody: '0xzz' })],
    ['a fractional validUntil', (r: Record<string, unknown>) => ({ ...r, validUntil: 1.5 })],
    ['proofs that are not an array', (r: Record<string, unknown>) => ({ ...r, proofs: 'none' })],
  ] as const)('refuses %s with a TypeError or RangeError before any provider call', async (_name, change) => {
    const built = rig();
    const thrown = await rejectionOf(submit(built, s, change(s.request() as unknown as Record<string, unknown>)));

    expect(thrown instanceof TypeError || thrown instanceof RangeError).toBe(true);
    expect(built.seen).toEqual([]);
  });

  it.each([
    ['a string', '1760000000'],
    ['a negative number', -1],
    ['a fraction', 1.5],
    ['NaN', Number.NaN],
  ] as const)('refuses a now that is %s before any provider call', async (_name, now) => {
    const built = rig();
    const thrown = await rejectionOf(submit(built, s, s.request(), now));

    expect(thrown instanceof TypeError || thrown instanceof RangeError).toBe(true);
    expect(built.seen).toEqual([]);
  });

  it.each([
    ['options that are a string', 'simulate'],
    ['a non-boolean simulate', { simulate: 'yes' }],
    ['a malformed from', { from: '0x1234' }],
  ] as const)('refuses %s before any provider call', async (_name, options) => {
    const built = rig();
    const thrown = await rejectionOf(submit(built, s, s.request(), NOW, options));

    expect(thrown instanceof TypeError || thrown instanceof RangeError).toBe(true);
    expect(built.seen).toEqual([]);
  });

  it('skips the simulation by the configuration default: no simulation member and no eth_call', async () => {
    const built = rig();
    const prepared = await submit(built, s, s.request());

    expect(prepared.simulation).toBeUndefined();
    expect('simulation' in prepared).toBe(false);
    expect(callsTo(built.seen, 'provider', 'call')).toEqual([]);
  });

  it('skips the simulation when the option says so over a simulating configuration', async () => {
    const built = rig(world(), { ...CLIENT_CONFIGURATION, simulate: true });
    const prepared = await submit(built, s, s.request(), NOW, { simulate: false });

    expect(prepared.simulation).toBeUndefined();
    expect(callsTo(built.seen, 'provider', 'call')).toEqual([]);
  });

  it('simulates from the zero address where no from is given, at the pinned block', async () => {
    const built = rig(world(), { ...CLIENT_CONFIGURATION, simulate: true });
    const request = s.request();
    const prepared = await submit(built, s, request);

    expect(prepared.simulation).toEqual({ success: true });

    const [call] = callsTo(built.seen, 'provider', 'call');

    expect(String(call?.args[0]).toLowerCase()).toBe(MANAGER.toLowerCase());
    expect(String(call?.args[1]).toLowerCase()).toBe(s.data(request as never).toLowerCase());
    expect(String(call?.args[2]).toLowerCase()).toBe(ZERO);
    expect(call?.args[3]).toBe(HEADER.number);
  });

  it('simulates from options.from', async () => {
    const built = rig();

    await submit(built, s, s.request(), NOW, { simulate: true, from: SPONSOR });

    expect(String(callsTo(built.seen, 'provider', 'call')[0]?.args[2]).toLowerCase()).toBe(SPONSOR.toLowerCase());
  });

  it('returns a revert as a typed failure from the simulating address', async () => {
    const data: Hex = '0xdeadbeef';
    const built = rig(world(), CLIENT_CONFIGURATION, { call: async () => Promise.reject({ data }) });
    const prepared = await submit(built, s, s.request(), NOW, { simulate: true, from: SPONSOR });

    expect(prepared.simulation).toEqual({ success: false, from: expect.any(String), error: decodeRevert(data) });
    expect((prepared.simulation as { from: string }).from.toLowerCase()).toBe(SPONSOR.toLowerCase());
  });

  it('rejects with the transport failure itself', async () => {
    const built = rig(world({ failures: new Map([['provider.call', INJECTED]]) }));

    await expect(submit(built, s, s.request(), NOW, { simulate: true })).rejects.toBe(INJECTED);
  });

  it('rejects with a block read failure itself and calls no part', async () => {
    const built = rig(world({ failures: new Map([['provider.block', INJECTED]]) }));

    await expect(submit(built, s, s.request())).rejects.toBe(INJECTED);
    expect(callsTo(built.seen, 'manager', s.member)).toEqual([]);
  });
});

describe('prepareStartAttempt: the opening payload', () => {
  it.each([
    ['three bytes', '0xabcdef'],
    ['the empty payload', '0x'],
    ['a pair with a trailing byte', `${payloadOf(KEY_NEW, ACCOUNT)}00`],
  ] as const)('refuses a payload the codec cannot decode (%s) with one handover.malformed finding', async (_name, payload) => {
    const built = rig();
    const thrown = await rejectionOf(built.client.prepareStartAttempt({ ...boundAttempt(), payload: payload as Hex }, NOW));

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(errorCodes(thrown)).toEqual(['handover.malformed']);
    expect(Object.hasOwn(thrown as object, 'cause')).toBe(false);
    expect(callsTo(built.seen, 'manager', 'prepareStartAttempt')).toEqual([]);
    expect(callsTo(built.seen, 'provider', 'call')).toEqual([]);
  });
});

describe('a request of the other kind', () => {
  it('prepareStartAttempt refuses a cancel request with a TypeError before any provider call', async () => {
    const built = rig();
    const thrown = await rejectionOf(built.client.prepareStartAttempt(boundCancel() as unknown as AttemptRequest, NOW));

    expect(thrown).toBeInstanceOf(TypeError);
    expect(built.seen).toEqual([]);
  });

  it('prepareCancelByProofs refuses an attempt request with a TypeError before any provider call', async () => {
    const built = rig();
    const thrown = await rejectionOf(built.client.prepareCancelByProofs(boundAttempt() as unknown as CancelRequest, NOW));

    expect(thrown).toBeInstanceOf(TypeError);
    expect(built.seen).toEqual([]);
  });
});
