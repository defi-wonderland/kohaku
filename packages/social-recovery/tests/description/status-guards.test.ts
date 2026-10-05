import { describe, expect, it } from 'vitest';
import { describeStatus, type KitNotification, type RecoveryState, type SetupState } from '../../src/index';
import { at, paused, METHOD_A, RECOVERY_STATE, SCOPE, SETUP_STATE } from './status-fixtures';

const call = (setup: unknown, recovery: unknown, latest: readonly unknown[]) => () =>
  describeStatus(setup as SetupState, recovery as RecoveryState, latest as KitNotification[], SCOPE);

/** A pattern matching a message that starts with the given member path, followed by a space. */
const naming = (member: string): RegExp => new RegExp(`^${member.replace(/[.[\]]/g, '\\$&')} `);

describe('describeStatus refuses records missing what it reads, naming the member', () => {
  it.each<readonly [string, unknown, string]>([
    ['with only an empty block', { block: {} }, 'setupState.isAuthorized'],
    ['with isAuthorized as text', { ...SETUP_STATE, isAuthorized: 'true' }, 'setupState.isAuthorized'],
    ['with a short commitment', { ...SETUP_STATE, setupCommitment: '0x1234' }, 'setupState.setupCommitment'],
    ['with a number nonce', { ...SETUP_STATE, setupNonce: 3 }, 'setupState.setupNonce'],
    ['with a negative setup block', { ...SETUP_STATE, setupCommittedAtBlock: -1 }, 'setupState.setupCommittedAtBlock'],
    ['with a short block hash', { ...SETUP_STATE, block: { ...SETUP_STATE.block, hash: '0x12' } }, 'setupState.block.hash'],
  ])('throws a TypeError for a setup state %s', (_case, setup, member) => {
    expect(call(setup, RECOVERY_STATE, [])).toThrow(TypeError);
    expect(call(setup, RECOVERY_STATE, [])).toThrow(naming(member));
  });

  it.each<readonly [string, unknown, string]>([
    ['with a short block hash', { ...RECOVERY_STATE, block: { ...RECOVERY_STATE.block, hash: '0x12' } }, 'recoveryState.block.hash'],
    ['with a text timestamp', { ...RECOVERY_STATE, block: { ...RECOVERY_STATE.block, timestamp: '1700000000' } }, 'recoveryState.block.timestamp'],
  ])('throws a TypeError for a recovery state %s', (_case, recovery, member) => {
    expect(call(SETUP_STATE, recovery, [])).toThrow(TypeError);
    expect(call(SETUP_STATE, recovery, [])).toThrow(naming(member));
  });

  it.each<readonly [string, unknown, string]>([
    ['without at', { kind: 'method-paused', method: METHOD_A, by: METHOD_A }, 'latest[1].at'],
    ['with a text removed flag', { ...paused(METHOD_A, at(91)), at: { ...at(91), removed: 'no' } }, 'latest[1].at.removed'],
    ['with a text log index', { ...paused(METHOD_A, at(91)), at: { ...at(91), logIndex: '0' } }, 'latest[1].at.logIndex'],
    ['with a negative block number', { ...paused(METHOD_A, at(91)), at: { ...at(91), blockNumber: -1 } }, 'latest[1].at.blockNumber'],
    ['with a text block number', { ...paused(METHOD_A, at(91)), at: { ...at(91), blockNumber: '91' } }, 'latest[1].at.blockNumber'],
    ['without kind', { method: METHOD_A, by: METHOD_A, at: at(91) }, 'latest[1].kind'],
    ['that is not an object', 'method-paused', 'latest[1]'],
  ])('throws a TypeError for a notification %s', (_case, notification, member) => {
    const latest = [paused(METHOD_A, at(90)), notification];

    expect(call(SETUP_STATE, RECOVERY_STATE, latest)).toThrow(TypeError);
    expect(call(SETUP_STATE, RECOVERY_STATE, latest)).toThrow(naming(member));
  });

  it('describes the well-formed fixtures', () => {
    expect(call(SETUP_STATE, RECOVERY_STATE, [paused(METHOD_A, at(90))])).not.toThrow();
  });
});
