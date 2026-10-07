import {
  SETUP_CLIENT_PASSWORD_MISSING_MESSAGE,
  SETUP_CLIENT_PASSWORD_UNUSED_MESSAGE,
  SETUP_CLIENT_VERSION_ESCAPED_MESSAGE,
} from '../constants';
import { KitRefusalError } from '../client-core';
import { assertPassword } from '../encryption/cipher';
import { assertArray, assertBool, assertObject, normalizeAddress, sameAddress } from '../formats/guards';
import { NAMED_BLOCK_TAGS, type Address, type IActionCodec, type PrepareOptions, type SetupDraft } from '../interfaces';
import type { SetupClientParts } from '../types/setup-client';

/** Refuses a dependency that is not an object with every named member callable. */
function assertDependency(value: unknown, members: readonly string[], name: string): void {
  assertObject(value, name);

  for (const member of members) {
    if (typeof (value as Readonly<Record<string, unknown>>)[member] !== 'function') {
      throw new TypeError(`${name}.${member} must be a function`);
    }
  }
}

/** Refuses a codec that is not one or does not serve the action. */
function assertServes(codec: IActionCodec, action: Address): void {
  assertDependency(codec, ['decode'], 'codec');
  assertArray(codec.actions, 'codec.actions');

  const served = codec.actions.map((entry, index) => normalizeAddress(entry, `codec.actions[${index}]`));

  if (!served.some((entry) => sameAddress(entry, action))) throw new RangeError(`action ${action} is not one the codec serves`);
}

/**
 * The client's inputs with the account and action checksummed, refusing a malformed part or record, a read tag that is
 * not a named block tag, and a given codec that does not serve the action.
 */
export function checkedParts(parts: SetupClientParts): SetupClientParts {
  const { provider, descriptor, configuration, descriptorOrigin, policyManager, recoveryAction, events, methods, codec } = parts;

  assertDependency(provider, ['block', 'call', 'code'], 'provider');
  assertObject(descriptor, 'descriptor');
  assertObject(configuration, 'configuration');
  assertObject(configuration.blockTags, 'configuration.blockTags');

  if (!NAMED_BLOCK_TAGS.includes(configuration.blockTags.read)) throw new TypeError('configuration.blockTags.read must be a named block tag');

  if (descriptorOrigin !== 'kit' && descriptorOrigin !== 'integrator') throw new TypeError('descriptorOrigin must be kit or integrator');

  assertDependency(policyManager, ['prepareCommitSetup', 'prepareClearSetup', 'stateOf', 'moduleInfo', 'paused', 'trustedParties'], 'policyManager');
  assertDependency(
    recoveryAction,
    ['supportsAccount', 'isAuthority', 'isAuthorized', 'actionInfo', 'disarmingCall', 'armingCall'],
    'recoveryAction',
  );
  assertDependency(events, ['accountFilter', 'fetch'], 'events');
  assertDependency(methods, ['get', 'keys'], 'methods');

  if (parts.signerRecovery !== undefined) assertDependency(parts.signerRecovery, ['recoverSigner'], 'signerRecovery');

  const account = normalizeAddress(parts.account, 'account');
  const action = normalizeAddress(parts.action, 'action');

  if (codec !== undefined) assertServes(codec, action);

  return { ...parts, account, action };
}

/** Refuses options that are not an object, or whose `simulate` is present and not a boolean. */
export function assertOptions(options: PrepareOptions | undefined): void {
  if (options === undefined) return;

  assertObject(options, 'options');

  if (options.simulate !== undefined) assertBool(options.simulate, 'options.simulate');
}

/** Refuses every prepare of a client built for a deployment version this build does not serve. */
export function assertPreparesServed(versionEscaped: boolean): void {
  if (versionEscaped) throw new KitRefusalError(SETUP_CLIENT_VERSION_ESCAPED_MESSAGE);
}

/**
 * Refuses an encrypted backup without a password, and a password beside a clear or empty backup;
 * a password that is not a well-formed string throws a `TypeError`.
 */
export function assertBackupPassword(draft: SetupDraft, password: string | undefined): void {
  if (password !== undefined) assertPassword(password);

  const encrypted = draft.privacy.backup === 'encrypted';

  if (encrypted && password === undefined) throw new KitRefusalError(SETUP_CLIENT_PASSWORD_MISSING_MESSAGE);

  if (!encrypted && password !== undefined) throw new KitRefusalError(SETUP_CLIENT_PASSWORD_UNUSED_MESSAGE);
}
