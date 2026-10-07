import { FORMATS_SAFE_INTEGER_BITS } from '../constants';
import { assertArray, assertObject, assertUintNumber, normalizeAddress, sameAddress } from '../formats/guards';
import type { CheckedRemovedKeyInputs, RemovedKeyInputs } from '../types/removed-key';

/** Refuses a member that is not a function. */
function assertCallable(owner: object, member: string, name: string): void {
  if (typeof (owner as Readonly<Record<string, unknown>>)[member] !== 'function') throw new TypeError(`${name}.${member} must be a function`);
}

/** Refuses a dependency that is not an object with every named member callable. */
function assertDependency(value: unknown, members: readonly string[], name: string): void {
  assertObject(value, name);
  members.forEach((member) => assertCallable(value, member, name));
}

/** The inputs with every address checksummed, refusing malformed ones before anything is read. */
export function checkedInputs(inputs: unknown): CheckedRemovedKeyInputs {
  assertObject(inputs, 'inputs');

  const given = inputs as RemovedKeyInputs;
  const supplied = given.supplied === undefined ? undefined : normalizeAddress(given.supplied, 'inputs.supplied');
  const account = normalizeAddress(given.account, 'inputs.account');
  const actionAddress = normalizeAddress(given.actionAddress, 'inputs.actionAddress');

  assertObject(given.descriptor, 'inputs.descriptor');
  assertUintNumber(given.descriptor.deployedAt, FORMATS_SAFE_INTEGER_BITS, 'inputs.descriptor.deployedAt');
  assertDependency(given.events, ['accountFilter', 'fetch'], 'inputs.events');
  assertDependency(given.action, ['isAuthority'], 'inputs.action');
  assertDependency(given.provider, ['transaction'], 'inputs.provider');

  if (given.signerRecovery !== undefined) assertDependency(given.signerRecovery, ['recoverSigner'], 'inputs.signerRecovery');

  assertDependency(given.codec, ['decode'], 'inputs.codec');
  assertArray(given.codec.actions, 'inputs.codec.actions');

  const served = given.codec.actions.map((entry, index) => normalizeAddress(entry, `inputs.codec.actions[${index}]`));

  if (!served.some((entry) => sameAddress(entry, actionAddress))) {
    throw new TypeError(`inputs.codec does not serve action ${actionAddress}`);
  }

  return { ...given, supplied, account, actionAddress };
}
