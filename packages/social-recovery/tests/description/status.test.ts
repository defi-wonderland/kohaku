import { describe, expect, it } from 'vitest';
import { ATTEMPT_STATES, describeStatus, type KitNotification } from '../../src/index';
import {
  at,
  BLOCK_TIME,
  COMMITMENT,
  HASH_ONE,
  HASH_TWO,
  HOLDER,
  IDLE_STATE,
  METHOD_A,
  METHOD_B,
  METHOD_C,
  paused,
  PAYLOAD,
  RECOVERY_STATE,
  SETUP_STATE,
  started,
  unpaused,
  WAITING,
} from './status-fixtures';

describe('describeStatus: the block', () => {
  it('names the one hash both records carry', () => {
    expect(describeStatus(SETUP_STATE, RECOVERY_STATE, []).block).toEqual({ sameBlock: true, hash: HASH_ONE });
  });

  it('marks records read at two heights with both hashes', () => {
    const recovery = { ...RECOVERY_STATE, block: { ...RECOVERY_STATE.block, hash: HASH_TWO } };

    expect(describeStatus(SETUP_STATE, recovery, []).block).toEqual({ sameBlock: false, setupHash: HASH_ONE, recoveryHash: HASH_TWO });
  });

  it('judges the pair by hash alone, so equal numbers with different hashes still differ', () => {
    const recovery = { ...RECOVERY_STATE, block: { number: SETUP_STATE.block.number, timestamp: BLOCK_TIME, hash: HASH_TWO } };

    expect(describeStatus(SETUP_STATE, recovery, []).block.sameBlock).toBe(false);
  });
});

describe('describeStatus: the attempt', () => {
  it('is absent when the account has no attempt', () => {
    const description = describeStatus(SETUP_STATE, IDLE_STATE, []);

    expect('attempt' in description).toBe(false);
    expect(description.stops).toEqual([]);
  });

  it('carries the attempt\'s state, id, raw wait end, block time, methods, stop choice and order', () => {
    const description = describeStatus(SETUP_STATE, RECOVERY_STATE, []);

    expect(description.attempt).toEqual({
      state: 'Waiting',
      attemptId: 5n,
      consumableAfter: WAITING.consumableAfter,
      blockTimestamp: BLOCK_TIME,
      usedMethods: [METHOD_A, METHOD_B],
      ignoresPause: false,
      order: WAITING.order,
    });
  });

  it('leaves usedPlaces and payload out where the notifications hold no opening', () => {
    const attempt = describeStatus(SETUP_STATE, RECOVERY_STATE, [paused(METHOD_A, at(95))]).attempt;

    expect(attempt !== undefined && 'usedPlaces' in attempt).toBe(false);
    expect(attempt !== undefined && 'payload' in attempt).toBe(false);
  });

  it('takes usedPlaces and payload from the opening notification of this attempt', () => {
    const attempt = describeStatus(SETUP_STATE, RECOVERY_STATE, [started(5n, [0n, 2n], PAYLOAD, at(96))]).attempt;

    expect(attempt).toMatchObject({ usedPlaces: [0n, 2n], payload: PAYLOAD });
  });

  it('prefers the latest opening when an earlier attempt\'s opening is also passed', () => {
    const latest = [started(4n, [1n], '0xdead', at(80)), started(5n, [0n, 2n], PAYLOAD, at(96))];

    expect(describeStatus(SETUP_STATE, RECOVERY_STATE, latest).attempt).toMatchObject({ usedPlaces: [0n, 2n], payload: PAYLOAD });
  });

  it.each(ATTEMPT_STATES.filter((state) => state !== 'None'))('shows a %s attempt with its state', (state) => {
    const recovery = { ...RECOVERY_STATE, attempt: { ...WAITING, state } };

    expect(describeStatus(SETUP_STATE, recovery, []).attempt?.state).toBe(state);
  });

  it('carries an attempt that ignores stops as such', () => {
    const recovery = { ...RECOVERY_STATE, attempt: { ...WAITING, ignoresPause: true } };

    expect(describeStatus(SETUP_STATE, recovery, []).attempt?.ignoresPause).toBe(true);
  });
});

describe('describeStatus: armed and setup', () => {
  it('is armed exactly when the setup record says the action is authorized', () => {
    expect(describeStatus(SETUP_STATE, RECOVERY_STATE, []).armed).toBe(true);
    expect(describeStatus({ ...SETUP_STATE, isAuthorized: false }, RECOVERY_STATE, []).armed).toBe(false);
  });

  it('carries the commitment, nonce and block of the last setup write from the setup record', () => {
    const setup = { ...SETUP_STATE, setupNonce: 8n, setupCommittedAtBlock: 77 };

    expect(describeStatus(setup, RECOVERY_STATE, []).setup).toEqual({ setupCommitment: COMMITMENT, setupNonce: 8n, setupCommittedAtBlock: 77 });
  });
});

describe('describeStatus: stops from the notifications alone', () => {
  it('lists every used method, with no latest stop notification where none was passed', () => {
    const stops = describeStatus(SETUP_STATE, RECOVERY_STATE, []).stops;

    expect(stops.map((stop) => stop.method)).toEqual([METHOD_A, METHOD_B]);
    expect(stops.every((stop) => !('latest' in stop) || stop.latest === undefined)).toBe(true);
  });

  it('takes the latest pause or unpause per used method and ignores methods the attempt did not use', () => {
    const latest: KitNotification[] = [
      paused(METHOD_A, at(91)),
      unpaused(METHOD_A, at(93)),
      paused(METHOD_B, at(92)),
      paused(METHOD_C, at(99)),
    ];
    const stops = describeStatus(SETUP_STATE, RECOVERY_STATE, latest).stops;

    expect(stops).toEqual([
      { method: METHOD_A, latest: unpaused(METHOD_A, at(93)) },
      { method: METHOD_B, latest: paused(METHOD_B, at(92)) },
    ]);
  });

  it('orders two notifications of one block by log index', () => {
    const latest = [unpaused(METHOD_A, at(94, 1)), paused(METHOD_A, at(94, 7))];
    const stop = describeStatus(SETUP_STATE, RECOVERY_STATE, latest).stops.find((entry) => entry.method === METHOD_A);

    expect(stop?.latest).toEqual(paused(METHOD_A, at(94, 7)));
  });

  it('takes the latest by chain position even when the list passes it first', () => {
    const latest = [paused(METHOD_B, at(95)), unpaused(METHOD_B, at(91))];
    const stop = describeStatus(SETUP_STATE, RECOVERY_STATE, latest).stops.find((entry) => entry.method === METHOD_B);

    expect(stop?.latest).toEqual(paused(METHOD_B, at(95)));
  });

  it('counts only pause and unpause notifications as a stop', () => {
    const latest: KitNotification[] = [
      { kind: 'method-pause-holder-transferred', method: METHOD_A, previous: HOLDER, current: HOLDER, at: at(95) },
    ];

    expect(describeStatus(SETUP_STATE, RECOVERY_STATE, latest).stops.find((entry) => entry.method === METHOD_A)?.latest).toBeUndefined();
  });
});
