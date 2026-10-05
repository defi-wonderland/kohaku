import { describe, expect, it } from 'vitest';
import { describeStatus, type KitNotification, type RecoveryState, type SetupState } from '../../src/index';
import { at, paused, METHOD_A, RECOVERY_STATE, SCOPE, SETUP_STATE } from './status-fixtures';

const call = (setup: unknown, recovery: unknown, latest: readonly unknown[]) => () =>
  describeStatus(setup as SetupState, recovery as RecoveryState, latest as KitNotification[], SCOPE);

describe('describeStatus refuses records missing what it reads', () => {
  it.each<readonly [string, unknown]>([
    ['with only an empty block', { block: {} }],
    ['with isAuthorized as text', { ...SETUP_STATE, isAuthorized: 'true' }],
    ['with a short commitment', { ...SETUP_STATE, setupCommitment: '0x1234' }],
    ['with a number nonce', { ...SETUP_STATE, setupNonce: 3 }],
    ['with a negative setup block', { ...SETUP_STATE, setupCommittedAtBlock: -1 }],
    ['with a short block hash', { ...SETUP_STATE, block: { ...SETUP_STATE.block, hash: '0x12' } }],
  ])('throws a TypeError for a setup state %s', (_case, setup) => {
    expect(call(setup, RECOVERY_STATE, [])).toThrow(TypeError);
  });

  it.each<readonly [string, unknown]>([
    ['with a short block hash', { ...RECOVERY_STATE, block: { ...RECOVERY_STATE.block, hash: '0x12' } }],
    ['with a text timestamp', { ...RECOVERY_STATE, block: { ...RECOVERY_STATE.block, timestamp: '1700000000' } }],
  ])('throws a TypeError for a recovery state %s', (_case, recovery) => {
    expect(call(SETUP_STATE, recovery, [])).toThrow(TypeError);
  });

  it.each<readonly [string, unknown]>([
    ['without at', { kind: 'method-paused', method: METHOD_A, by: METHOD_A }],
    ['with a text removed flag', { ...paused(METHOD_A, at(91)), at: { ...at(91), removed: 'no' } }],
    ['with a text log index', { ...paused(METHOD_A, at(91)), at: { ...at(91), logIndex: '0' } }],
    ['without kind', { method: METHOD_A, by: METHOD_A, at: at(91) }],
    ['that is not an object', 'method-paused'],
  ])('throws a TypeError for a notification %s', (_case, notification) => {
    expect(call(SETUP_STATE, RECOVERY_STATE, [paused(METHOD_A, at(90)), notification])).toThrow(TypeError);
  });

  it('describes the well-formed fixtures', () => {
    expect(call(SETUP_STATE, RECOVERY_STATE, [paused(METHOD_A, at(90))])).not.toThrow();
  });
});
