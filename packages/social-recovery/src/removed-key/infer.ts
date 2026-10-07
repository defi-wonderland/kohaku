import type { KitNotification, PinnedBlock, RemovedKey } from '../interfaces';
import type { CheckedRemovedKeyInputs, RemovedKeyInputs } from '../types/removed-key';
import { checkedBlock } from '../formats/guards';
import { checkedInputs } from './check';
import { isWellFormedAnswer } from './select';
import { confirm, fromHandover, fromSetupSigner } from './steps';

/** The bound account's and action's manager notifications from the deployment block to the pinned one; `unread` where the read fails. */
async function readNotifications(
  inputs: CheckedRemovedKeyInputs,
  block: PinnedBlock,
): Promise<readonly KitNotification[] | 'unread'> {
  if (inputs.descriptor.deployedAt > block.number) return [];

  try {
    const notifications: unknown = await inputs.events.fetch(inputs.events.accountFilter(), {
      from: inputs.descriptor.deployedAt,
      to: block.number,
    });

    return isWellFormedAnswer(notifications) ? notifications : 'unread';
  } catch {
    return 'unread';
  }
}

/**
 * The key a handover removes for the bound account, each candidate counting only once `isAuthority` confirms it at `block`:
 * a supplied address alone, else the latest consumed handover's new key, else the signer of the latest setup commit.
 * Throws a `TypeError` or `RangeError` on malformed inputs before any read; a failed read resolves to `unread` and nothing after it is read.
 */
export async function inferRemovedKey(inputs: RemovedKeyInputs, block: PinnedBlock): Promise<RemovedKey> {
  const checked = checkedInputs(inputs);

  checkedBlock(block, 'block');

  if (checked.supplied !== undefined) {
    const answer = await confirm(checked.supplied, checked, block);

    return answer === 'denied' ? 'not-a-key' : answer;
  }

  let denied = false;

  const notifications = await readNotifications(checked, block);

  if (notifications === 'unread') return 'unread';

  for (const step of [fromHandover, fromSetupSigner]) {
    const answer = await step(notifications, checked, block);

    if (answer === 'denied') denied = true;
    else if (answer !== undefined) return answer;
  }

  return denied ? 'not-a-key' : 'no-source';
}
