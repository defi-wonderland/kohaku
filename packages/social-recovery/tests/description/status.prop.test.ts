import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ATTEMPT_STATES, describeStatus, type Address, type Hex, type KitNotification, type RecoveryState, type SetupState } from '../../src/index';
import { address, bytesN, TIMEOUT, run, uint } from '../formats/arbitraries';
import { at, HOLDER } from './status-fixtures';

const hash = fc.oneof(fc.constant<Hex>(`0x${'1a'.repeat(32)}`), bytesN(32));
const block = fc.record({ number: fc.nat(1_000_000), timestamp: fc.nat(2 ** 40), hash });
const methods = fc.uniqueArray(address, { maxLength: 4, selector: (method) => method.toLowerCase() });

const attempt = fc.record({
  attemptId: uint(64),
  setupNonce: uint(64),
  consumableAfter: fc.nat(2 ** 48 - 1),
  state: fc.constantFrom(...ATTEMPT_STATES),
  payloadHash: bytesN(32),
  order: fc.record({ token: address, amount: uint(256), payee: address }),
  usedMethods: methods,
  ignoresPause: fc.boolean(),
});

const setupState: fc.Arbitrary<SetupState> = fc.record({
  isAuthorized: fc.boolean(),
  hasSetup: fc.boolean(),
  setupCommitment: bytesN(32),
  setupNonce: uint(64),
  setupCommittedAtBlock: fc.nat(1_000_000),
  attemptActive: fc.boolean(),
  block,
});

const recoveryState: fc.Arbitrary<RecoveryState> = fc.record({
  attempt,
  nextAttemptId: uint(64),
  setupCommitment: bytesN(32),
  setupNonce: uint(64),
  removedKey: fc.constant('unread' as const),
  block,
});

const notification = (pool: readonly Address[]): fc.Arbitrary<KitNotification> => {
  const method = pool.length === 0 ? address : fc.oneof(fc.constantFrom(...pool), address);
  const position = fc.tuple(fc.nat(1_000), fc.nat(50)).map(([number, index]) => at(number, index));

  return fc.oneof(
    fc.record({ kind: fc.constantFrom('method-paused' as const, 'method-unpaused' as const), method, by: fc.constant(HOLDER), at: position }),
    fc.record({
      kind: fc.constant('attempt-started' as const),
      account: address,
      action: address,
      attemptId: uint(64),
      setupNonce: uint(64),
      setupBody: bytesN(8),
      usedPlaces: fc.array(fc.bigInt({ min: 0n, max: 255n }), { maxLength: 4 }),
      usedMethods: methods,
      payload: bytesN(64),
      order: fc.record({ token: address, amount: uint(256), payee: address }),
      consumableAfter: fc.nat(2 ** 48 - 1),
      at: position,
    }),
  );
};

const inputs = fc
  .tuple(setupState, recoveryState)
  .chain(([setup, recovery]) =>
    fc.array(notification(recovery.attempt.usedMethods), { maxLength: 8 }).map((latest) => ({ setup, recovery, latest })),
  );

describe('describeStatus over arbitrary consistent records', () => {
  it('never throws and keeps block, armed, setup, attempt and stops tied to their sources', () => {
    run(fc.property(inputs, ({ setup, recovery, latest }) => {
      const description = describeStatus(setup, recovery, latest);
      const same = setup.block.hash.toLowerCase() === recovery.block.hash.toLowerCase();

      expect(description.block.sameBlock).toBe(same);
      expect(description.armed).toBe(setup.isAuthorized);
      expect(description.setup).toEqual({
        setupCommitment: setup.setupCommitment,
        setupNonce: setup.setupNonce,
        setupCommittedAtBlock: setup.setupCommittedAtBlock,
      });

      if (recovery.attempt.state === 'None') {
        expect(description.attempt).toBeUndefined();
        expect(description.stops).toEqual([]);

        return;
      }

      expect(description.attempt?.attemptId).toBe(recovery.attempt.attemptId);
      expect(description.stops.map((stop) => stop.method.toLowerCase())).toEqual(recovery.attempt.usedMethods.map((m) => m.toLowerCase()));

      for (const stop of description.stops) {
        if (stop.latest !== undefined) expect(stop.latest.method.toLowerCase()).toBe(stop.method.toLowerCase());
      }
    }));
  }, TIMEOUT);
});
