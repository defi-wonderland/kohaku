import type { Address, PinnedBlock, RemovedKey } from '../interfaces';
import { inferRemovedKey } from '../removed-key';
import type { RecoveryClientParts } from '../types/recovery-client';

/**
 * The key `inferRemovedKey` names for the bound account, with `supplied` as the only candidate where given.
 * A supplied key's `isAuthority` read is the handover's own check, so its rejection rejects the init with the same value;
 * a read the inference makes on its own that fails names nothing, as `unread`.
 */
export async function removedKeyOf(parts: RecoveryClientParts, supplied: Address | undefined, block: PinnedBlock): Promise<RemovedKey> {
  let rejection: { readonly thrown: unknown } | undefined;

  const isAuthority = async (candidate: Address, at?: PinnedBlock): Promise<boolean> => {
    try {
      return await parts.recoveryAction.isAuthority(candidate, at);
    } catch (thrown) {
      if (supplied !== undefined) rejection ??= { thrown };

      throw thrown;
    }
  };
  const key = await inferRemovedKey(
    {
      events: parts.events,
      action: { isAuthority },
      codec: parts.codec,
      provider: parts.provider,
      signerRecovery: parts.signerRecovery,
      supplied,
      descriptor: parts.descriptor,
      account: parts.account,
      actionAddress: parts.action,
    },
    block,
  );

  if (key === 'unread' && rejection !== undefined) throw rejection.thrown;

  return key;
}
