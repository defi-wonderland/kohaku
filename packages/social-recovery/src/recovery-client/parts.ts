import { assertArray, assertObject, normalizeAddress, sameAddress } from '../formats/guards';
import type { RecoveryClientParts } from '../types/recovery-client';

/** Refuses a part that is not an object with every named member callable. */
function assertPart(value: unknown, members: readonly string[], name: string): void {
  assertObject(value, name);

  for (const member of members) {
    if (typeof (value as Readonly<Record<string, unknown>>)[member] !== 'function') throw new TypeError(`${name}.${member} must be a function`);
  }
}

/**
 * The parts with every address checksummed, refusing a malformed part or address with a `TypeError` and an action the
 * codec does not serve with a `RangeError`, before anything is read.
 */
export function checkedParts(given: Omit<RecoveryClientParts, 'walletMethod'>): RecoveryClientParts {
  assertPart(given.provider, ['block', 'code', 'transaction'], 'provider');
  assertObject(given.descriptor, 'descriptor');
  assertObject(given.configuration, 'configuration');
  assertObject(given.configuration.blockTags, 'configuration.blockTags');
  assertPart(given.policyManager, ['stateOf', 'paused', 'trustedParties'], 'policyManager');
  assertPart(given.recoveryAction, ['isAuthority', 'holdsAnyPrivilege'], 'recoveryAction');
  assertPart(given.events, ['accountFilter', 'fetch'], 'events');
  assertPart(given.methods, ['get', 'has'], 'methods');
  assertPart(given.codec, ['encode', 'decode'], 'codec');
  assertArray(given.codec.actions, 'codec.actions');

  if (given.signerRecovery !== undefined) assertPart(given.signerRecovery, ['recoverSigner'], 'signerRecovery');

  const account = normalizeAddress(given.account, 'account');
  const action = normalizeAddress(given.action, 'action');
  const walletMethod = normalizeAddress(given.descriptor.methodEcdsa, 'descriptor.methodEcdsa');
  const served = given.codec.actions.map((entry, index) => normalizeAddress(entry, `codec.actions[${index}]`));

  if (!served.some((entry) => sameAddress(entry, action))) throw new RangeError(`action ${action} is not one the codec serves`);

  return { ...given, account, action, walletMethod };
}
