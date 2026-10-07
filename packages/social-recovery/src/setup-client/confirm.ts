import { decodeFunctionData } from 'viem';
import { POLICY_MANAGER_WRITES_ABI, SETUP_CLIENT_COMMITMENT_UNMATCHED_MESSAGE } from '../constants';
import { configurationCommitment, KitRefusalError } from '../client-core';
import { assertArray, assertBytes, assertObject, checkedBlock, lowerHex, sameAddress } from '../formats/guards';
import type { Hex, KitNotification, PreparedBatch, PreparedCall, SetupConfirmation, SetupDraft } from '../interfaces';
import type { SetupCommitted } from '../types/client-core';
import type { SetupClientParts } from '../types/setup-client';
import { checkedDraft, draftConfiguration } from './draft';
import { authorizedAt, pinRead } from './reads';

/** The nonce and commitment a call's data commits, where the data is a commit under the bound action. */
function committedBy(parts: SetupClientParts, call: unknown): { nonce: bigint; setupCommitment: Hex } | undefined {
  if (typeof call !== 'object' || call === null) return undefined;

  const { data } = call as Partial<PreparedCall>;

  try {
    assertBytes(data, 'data');

    const decoded = decodeFunctionData({ abi: POLICY_MANAGER_WRITES_ABI, data: lowerHex(data) });

    if (decoded.functionName !== 'commitSetup' || !sameAddress(decoded.args[0], parts.action)) return undefined;

    return { setupCommitment: lowerHex(decoded.args[1]), nonce: decoded.args[2] };
  } catch {
    return undefined;
  }
}

/** The commit the prepared record carries, alone or within its batch; a record carrying none throws a `TypeError`. */
function preparedCommit(parts: SetupClientParts, prepared: PreparedCall | PreparedBatch): { nonce: bigint; setupCommitment: Hex } {
  assertObject(prepared, 'prepared');

  let calls: readonly unknown[] = [prepared];

  if (prepared.kind === 'batch') {
    assertArray(prepared.calls, 'prepared.calls');
    calls = prepared.calls;
  } else if (prepared.kind !== 'call') {
    throw new TypeError(`prepared.kind must be 'call' or 'batch'`);
  }

  for (const call of calls) {
    const committed = committedBy(parts, call);

    if (committed !== undefined) return committed;
  }

  throw new TypeError('prepared carries no commitSetup under the bound action');
}

/** The live setup-committed events at the nonce, in log order. */
const committedAt = (notifications: readonly KitNotification[], nonce: bigint): SetupCommitted[] =>
  notifications.filter(
    (notification): notification is SetupCommitted =>
      notification.kind === 'setup-committed' && !notification.at.removed && notification.nonce === nonce,
  );

/**
 * Whether the prepared commit landed: a setup-committed event at its nonce carrying its commitment, read from the block the
 * prepare pinned to a block pinned now. Refuses where the draft does not recompute to the prepared commitment.
 */
export async function confirmAt(
  parts: SetupClientParts,
  draft: SetupDraft,
  prepared: PreparedCall | PreparedBatch,
): Promise<SetupConfirmation> {
  const credentials = checkedDraft(draft);
  const { nonce, setupCommitment } = preparedCommit(parts, prepared);
  const preparedBlock = checkedBlock(prepared.block, 'prepared.block');
  const recomputed = configurationCommitment(draftConfiguration(draft, credentials), parts.account, parts.action, nonce);

  if (recomputed !== setupCommitment) throw new KitRefusalError(SETUP_CLIENT_COMMITMENT_UNMATCHED_MESSAGE);

  const { block } = await pinRead(parts);
  const range = { from: preparedBlock.number, to: block.number };
  const [notifications, isAuthorized] = await Promise.all([
    range.from > range.to ? Promise.resolve([]) : parts.events.fetch(parts.events.accountFilter(), range),
    authorizedAt(parts, block),
  ]);
  const atNonce = committedAt(notifications, nonce);
  const landed = atNonce.find((event) => lowerHex(event.setupCommitment) === setupCommitment);
  const other = atNonce.at(-1);

  if (landed !== undefined) return { landed: true, nonce, setupCommitment, isAuthorized, position: landed.at };

  if (other !== undefined) return { landed: false, cause: 'other-commitment', nonce, setupCommitment, isAuthorized, position: other.at };

  return { landed: false, cause: 'no-event', nonce, setupCommitment, isAuthorized };
}
