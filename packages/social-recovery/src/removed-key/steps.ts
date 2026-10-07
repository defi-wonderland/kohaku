import { isAddressEqual, zeroAddress } from 'viem';
import { normalizeAddress, sameAddress } from '../formats/guards';
import type { Address, KitNotification, PinnedBlock } from '../interfaces';
import type { CheckedRemovedKeyInputs, RemovedKeyStepAnswer } from '../types/removed-key';
import { lastByPosition, latestConsumedStart, ofKind } from './select';

/** The key if `isAuthority` confirms it at the block, `denied` if not, `unread` where the read fails or answers no boolean. */
export async function confirm(key: Address, inputs: CheckedRemovedKeyInputs, block: PinnedBlock): Promise<Exclude<RemovedKeyStepAnswer, undefined>> {
  try {
    const answer: unknown = await inputs.action.isAuthority(key, block);

    if (typeof answer !== 'boolean') return 'unread';

    return answer ? key : 'denied';
  } catch {
    return 'unread';
  }
}

/** The new key of the highest-id consumed attempt, asked of `isAuthority`; nothing where its payload does not decode or names the zero address. */
export async function fromHandover(
  notifications: readonly KitNotification[],
  inputs: CheckedRemovedKeyInputs,
  block: PinnedBlock,
): Promise<RemovedKeyStepAnswer> {
  const start = latestConsumedStart(notifications, inputs);

  if (start === undefined) return undefined;

  let newAuthority: Address;

  try {
    newAuthority = normalizeAddress(inputs.codec.decode(start.payload).newAuthority, 'newAuthority');
  } catch {
    return undefined;
  }

  if (isAddressEqual(newAuthority, zeroAddress)) return undefined;

  return confirm(newAuthority, inputs, block);
}

/** The signer the integrator recovers from the transaction of the latest setup commit, asked of `isAuthority`. */
export async function fromSetupSigner(
  notifications: readonly KitNotification[],
  inputs: CheckedRemovedKeyInputs,
  block: PinnedBlock,
): Promise<RemovedKeyStepAnswer> {
  const { signerRecovery } = inputs;

  if (signerRecovery === undefined) return undefined;

  const commit = lastByPosition(ofKind(notifications, 'setup-committed', inputs));

  if (commit === undefined) return undefined;

  let signer: Address;

  try {
    const transaction = await inputs.provider.transaction(commit.at.transactionHash);

    if (
      transaction === undefined ||
      !sameAddress(transaction.hash, commit.at.transactionHash) ||
      !sameAddress(transaction.blockHash, commit.at.blockHash)
    ) {
      return 'unread';
    }

    const recovered = await signerRecovery.recoverSigner(transaction, inputs.account);

    if (recovered === undefined) return undefined;

    signer = normalizeAddress(recovered, 'recoverSigner');
  } catch {
    return 'unread';
  }

  return confirm(signer, inputs, block);
}
