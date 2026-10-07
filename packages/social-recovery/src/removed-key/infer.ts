import type { KitNotification, PinnedBlock, RemovedKey } from '../interfaces';
import type { CheckedRemovedKeyInputs, RemovedKeyInputs } from '../types/removed-key';
import { assertPinnedBlock, checkedInputs } from './check';
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

    return Array.isArray(notifications) ? (notifications as readonly KitNotification[]) : 'unread';
  } catch {
    return 'unread';
  }
}

/**
 * The key a handover removes for the bound account: the supplied address, else the latest consumed handover's new key,
 * else the signer of the latest setup commit, each counting only once `isAuthority` confirms it at `block`.
 * Throws a `TypeError` on malformed inputs before any read; a failed read resolves to `unread` and nothing after it is read.
 */
export async function inferRemovedKey(inputs: RemovedKeyInputs, block: PinnedBlock): Promise<RemovedKey> {
  const checked = checkedInputs(inputs);

  assertPinnedBlock(block, 'block');

  let denied = false;

  if (checked.supplied !== undefined) {
    const answer = await confirm(checked.supplied, checked, block);

    if (answer !== 'denied') return answer;

    denied = true;
  }

  const notifications = await readNotifications(checked, block);

  if (notifications === 'unread') return 'unread';

  for (const step of [fromHandover, fromSetupSigner]) {
    const answer = await step(notifications, checked, block);

    if (answer === 'denied') denied = true;
    else if (answer !== undefined) return answer;
  }

  return denied ? 'not-a-key' : 'no-source';
}
