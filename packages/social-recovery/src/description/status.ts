import { assertArray, assertObject } from '../formats/guards';
import type {
  Address,
  KitNotification,
  MethodStopNotification,
  RecoveryState,
  SetupState,
  StatusAttempt,
  StatusDescription,
} from '../interfaces';
import type { OpeningNotification } from '../types/description';

/** Orders notifications by block, then by log index; a tie keeps its arrival order. */
const byPosition = (left: KitNotification, right: KitNotification): number =>
  left.at.blockNumber - right.at.blockNumber || left.at.logIndex - right.at.logIndex;

/** The last of the notifications in chain order, leaving out any log the chain removed. */
function latestOf<Notification extends KitNotification>(notifications: readonly Notification[]): Notification | undefined {
  return notifications.filter((notification) => !notification.at.removed).sort(byPosition).at(-1);
}

const sameAddress = (left: Address, right: Address): boolean => left.toLowerCase() === right.toLowerCase();

const isStop = (notification: KitNotification): notification is MethodStopNotification =>
  notification.kind === 'method-paused' || notification.kind === 'method-unpaused';

const isOpening = (notification: KitNotification): notification is OpeningNotification =>
  notification.kind === 'attempt-started';

/** The block both records were read at, or the two hashes where they differ. */
function blockOf(setupState: SetupState, recoveryState: RecoveryState): StatusDescription['block'] {
  const setupHash = setupState.block.hash;
  const recoveryHash = recoveryState.block.hash;

  if (setupHash.toLowerCase() === recoveryHash.toLowerCase()) return { sameBlock: true, hash: setupHash };

  return { sameBlock: false, setupHash, recoveryHash };
}

/** The attempt beside the latest opening event of the same id, absent where the manager holds none. */
function attemptOf(recoveryState: RecoveryState, latest: readonly KitNotification[]): StatusAttempt | undefined {
  const { attempt } = recoveryState;

  if (attempt.state === 'None') return undefined;

  const opening = latestOf(latest.filter(isOpening).filter((event) => event.attemptId === attempt.attemptId));

  return {
    state: attempt.state,
    attemptId: attempt.attemptId,
    consumableAfter: attempt.consumableAfter,
    blockTimestamp: recoveryState.block.timestamp,
    usedMethods: [...attempt.usedMethods],
    ...(opening === undefined ? {} : { usedPlaces: [...opening.usedPlaces] }),
    ignoresPause: attempt.ignoresPause,
    ...(opening === undefined ? {} : { payload: opening.payload }),
    order: { ...attempt.order },
  };
}

/**
 * What a holder's status screen reads, composed from the two state records and the latest notifications with no read.
 * Throws a TypeError where a record or the notification list is not an object or an array.
 */
export function describeStatus(
  setupState: SetupState,
  recoveryState: RecoveryState,
  latest: readonly KitNotification[],
): StatusDescription {
  assertObject(setupState, 'setupState');
  assertObject(setupState.block, 'setupState.block');
  assertObject(recoveryState, 'recoveryState');
  assertObject(recoveryState.block, 'recoveryState.block');
  assertObject(recoveryState.attempt, 'recoveryState.attempt');
  assertArray(latest, 'latest');

  const attempt = attemptOf(recoveryState, latest);
  const stops = latest.filter(isStop);

  return {
    block: blockOf(setupState, recoveryState),
    ...(attempt === undefined ? {} : { attempt }),
    armed: setupState.isAuthorized,
    setup: {
      setupCommitment: setupState.setupCommitment,
      setupNonce: setupState.setupNonce,
      setupCommittedAtBlock: setupState.setupCommittedAtBlock,
    },
    stops: (attempt?.usedMethods ?? []).map((method) => {
      const stop = latestOf(stops.filter((notification) => sameAddress(notification.method, method)));

      return stop === undefined ? { method } : { method, latest: stop };
    }),
  };
}
