import { assertArray, assertObject, normalizeAddress, sameAddress } from '../formats/guards';
import { checkedConfiguration, checkedDescriptor } from '../formats/records';
import type { RecoveryClientParts } from '../types/recovery-client';

/** Refuses a part that is not an object with every named member callable. */
function assertPart(value: unknown, members: readonly string[], name: string): void {
  assertObject(value, name);

  for (const member of members) {
    if (typeof (value as Readonly<Record<string, unknown>>)[member] !== 'function') throw new TypeError(`${name}.${member} must be a function`);
  }
}

/**
 * The parts with every address checksummed and the descriptor and configuration as checked copies, refusing a malformed
 * part, address or record member with a `TypeError` or `RangeError`, and an action the codec does not serve with a `RangeError`, before anything is read.
 */
export function checkedParts(given: Omit<RecoveryClientParts, 'walletMethod'>): RecoveryClientParts {
  assertPart(given.provider, ['block', 'code', 'transaction'], 'provider');

  const descriptor = checkedDescriptor(given.descriptor, 'descriptor');
  const configuration = checkedConfiguration(given.configuration, 'configuration');

  assertPart(given.policyManager, ['stateOf', 'paused', 'trustedParties'], 'policyManager');
  assertPart(given.recoveryAction, ['isAuthority', 'holdsAnyPrivilege'], 'recoveryAction');
  assertPart(given.events, ['accountFilter', 'fetch'], 'events');
  assertPart(given.methods, ['get', 'has'], 'methods');
  assertPart(given.codec, ['encode', 'decode'], 'codec');
  assertArray(given.codec.actions, 'codec.actions');

  if (given.signerRecovery !== undefined) assertPart(given.signerRecovery, ['recoverSigner'], 'signerRecovery');

  const account = normalizeAddress(given.account, 'account');
  const action = normalizeAddress(given.action, 'action');
  const served = given.codec.actions.map((entry, index) => normalizeAddress(entry, `codec.actions[${index}]`));

  if (!served.some((entry) => sameAddress(entry, action))) throw new RangeError(`action ${action} is not one the codec serves`);

  return { ...given, descriptor, configuration, account, action, walletMethod: descriptor.methodEcdsa };
}
