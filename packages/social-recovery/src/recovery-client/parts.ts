import { FORMATS_SAFE_INTEGER_BITS } from '../constants';
import { assertArray, assertObject, assertUintNumber, normalizeAddress, sameAddress } from '../formats/guards';
import { decimalBigint } from '../gathering/edge';
import { NAMED_BLOCK_TAGS, type ClientConfiguration, type DeploymentDescriptor } from '../interfaces';
import type { RecoveryClientParts } from '../types/recovery-client';

/** Refuses a part that is not an object with every named member callable. */
function assertPart(value: unknown, members: readonly string[], name: string): void {
  assertObject(value, name);

  for (const member of members) {
    if (typeof (value as Readonly<Record<string, unknown>>)[member] !== 'function') throw new TypeError(`${name}.${member} must be a function`);
  }
}

/** The descriptor with the addresses the inits read checksummed, refusing a malformed member they read. */
function checkedDescriptor(descriptor: DeploymentDescriptor): DeploymentDescriptor {
  assertObject(descriptor, 'descriptor');
  assertUintNumber(descriptor.chainId, FORMATS_SAFE_INTEGER_BITS, 'descriptor.chainId');
  assertUintNumber(descriptor.deployedAt, FORMATS_SAFE_INTEGER_BITS, 'descriptor.deployedAt');
  decimalBigint(descriptor.digestVersion, FORMATS_SAFE_INTEGER_BITS, 'descriptor.digestVersion');

  return {
    ...descriptor,
    manager: normalizeAddress(descriptor.manager, 'descriptor.manager'),
    action: normalizeAddress(descriptor.action, 'descriptor.action'),
    methodEcdsa: normalizeAddress(descriptor.methodEcdsa, 'descriptor.methodEcdsa'),
  };
}

/** Refuses a malformed configuration member the inits read: the read tag and the cancel window. */
function assertConfiguration(configuration: ClientConfiguration): void {
  assertObject(configuration, 'configuration');
  assertObject(configuration.blockTags, 'configuration.blockTags');

  if (!NAMED_BLOCK_TAGS.includes(configuration.blockTags.read)) {
    throw new TypeError(`configuration.blockTags.read must be one of ${NAMED_BLOCK_TAGS.join(', ')}`);
  }

  assertUintNumber(configuration.cancelWindow, FORMATS_SAFE_INTEGER_BITS, 'configuration.cancelWindow');
}

/**
 * The parts with every address checksummed, refusing a malformed part, address or descriptor or configuration member the
 * inits read with a `TypeError` or `RangeError`, and an action the codec does not serve with a `RangeError`, before anything is read.
 */
export function checkedParts(given: Omit<RecoveryClientParts, 'walletMethod'>): RecoveryClientParts {
  assertPart(given.provider, ['block', 'code', 'transaction'], 'provider');

  const descriptor = checkedDescriptor(given.descriptor);

  assertConfiguration(given.configuration);
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

  return { ...given, descriptor, account, action, walletMethod: descriptor.methodEcdsa };
}
