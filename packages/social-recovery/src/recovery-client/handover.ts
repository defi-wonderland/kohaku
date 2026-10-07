import { RECOVERY_CLIENT_HANDOVER_REFUSED_MESSAGE } from '../constants';
import { KitRefusalError } from '../client-core';
import { assertBool } from '../formats/guards';
import { REMOVED_KEY_UNNAMED, type Address, type Handover, type PinnedBlock, type RemovedKey, type RemovedKeyUnnamed } from '../interfaces';
import type { Findings } from '../types/validation';
import type { RecoveryClientParts } from '../types/recovery-client';
import { addError, emptyFindings } from '../validation/common';
import { handoverFindings } from '../validation/request-handover';
import { removedKeyOf } from './inference';

/** Whether the inference named no address. */
const isUnnamed = (key: RemovedKey): key is RemovedKeyUnnamed => (REMOVED_KEY_UNNAMED as readonly string[]).includes(key);

/** The action's answer for the removed key: confirmed where an address was named, denied where the supplied one was refused. */
function removedIsAuthority(key: RemovedKey, supplied: Address | undefined): boolean | undefined {
  if (!isUnnamed(key)) return true;

  return supplied !== undefined && key === 'not-a-key' ? false : undefined;
}

/** Adds the finding that no removed key could be named: none inferred, or the supplied one left unread. */
function addUnnamed(findings: Findings, key: RemovedKey, supplied: Address | undefined, account: Address): void {
  if (!isUnnamed(key) || (supplied !== undefined && key !== 'unread')) return;

  addError(findings, 'handover.removed-unknown', 'request', { account, removedKey: key });
}

/**
 * The handover with the key it removes named: the supplied one once the action confirms it is a key, else the one
 * `inferRemovedKey` names. Refuses with one `KitRefusalError` carrying every handover finding: a zero address, one address
 * on both sides, a removed key that is not a key or cannot be named, and a new key that already holds a privilege.
 * Every read is pinned to `block`; a read that rejects rejects the init with the same value.
 */
export async function namedHandover(parts: RecoveryClientParts, handover: Handover, block: PinnedBlock): Promise<Required<Handover>> {
  const { newAuthority, removedAuthority: supplied } = handover;
  const key = await removedKeyOf(parts, supplied, block);
  const holds: unknown = await parts.recoveryAction.holdsAnyPrivilege(newAuthority, block);

  assertBool(holds, 'holdsAnyPrivilege');

  const named = isUnnamed(key) ? supplied : key;
  const findings = emptyFindings();

  handoverFindings(
    {
      handover: named === undefined ? { newAuthority } : { newAuthority, removedAuthority: named },
      layoutDecodes: true,
      removedIsAuthority: removedIsAuthority(key, supplied),
      newHoldsAnyPrivilege: holds,
    },
    findings,
  );
  addUnnamed(findings, key, supplied, parts.account);

  if (findings.errors.length > 0 || named === undefined) {
    throw new KitRefusalError(RECOVERY_CLIENT_HANDOVER_REFUSED_MESSAGE, { findings });
  }

  return { newAuthority, removedAuthority: named };
}
