import { lowerHex } from '../formats/guards';
import type { ActionState, Attempt, BlockHeader, PinnedBlock, RecoveryState, RemovedKey } from '../interfaces';
import { inferRemovedKey } from '../removed-key';
import type { RecoveryClientParts } from '../types/recovery-client';

/** The key a handover would remove, inferred at the block with no supplied address; a failed read inside answers `unread`. */
export async function removedKeyAt(parts: RecoveryClientParts, block: PinnedBlock): Promise<RemovedKey> {
  return await inferRemovedKey(
    {
      events: parts.events,
      action: parts.recoveryAction,
      codec: parts.codec,
      provider: parts.provider,
      signerRecovery: parts.signerRecovery,
      descriptor: parts.descriptor,
      account: parts.account,
      actionAddress: parts.action,
    },
    block,
  );
}

/** A copy of the manager's attempt, its payload hash lower-cased; a `None` attempt is the manager's zeroed one. */
function attemptCopy(attempt: Attempt): Attempt {
  return {
    attemptId: attempt.attemptId,
    setupNonce: attempt.setupNonce,
    consumableAfter: attempt.consumableAfter,
    state: attempt.state,
    payloadHash: lowerHex(attempt.payloadHash),
    order: { token: attempt.order.token, amount: attempt.order.amount, payee: attempt.order.payee },
    usedMethods: [...attempt.usedMethods],
    ignoresPause: attempt.ignoresPause,
  };
}

/** The recovery-side record of the manager's state, the inferred removed key and the block both were read at. */
export function recoveryRecord(state: ActionState, removedKey: RemovedKey, header: BlockHeader): RecoveryState {
  return {
    attempt: attemptCopy(state.attempt),
    nextAttemptId: state.nextAttemptId,
    setupCommitment: lowerHex(state.setupCommitment),
    setupNonce: state.setupNonce,
    removedKey,
    block: header,
  };
}
