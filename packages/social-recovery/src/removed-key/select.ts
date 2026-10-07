import type { KitNotification, LogPosition } from '../interfaces';
import { sameAddress } from '../formats/guards';
import type { CheckedRemovedKeyInputs, RemovedKeyNotification } from '../types/removed-key';

const isLater = (left: LogPosition, right: LogPosition): boolean =>
  left.blockNumber !== right.blockNumber ? left.blockNumber > right.blockNumber : left.logIndex > right.logIndex;

/** The bound account's and action's notifications of one kind, a log in a replaced block dropped. */
export function ofKind<K extends RemovedKeyNotification['kind']>(
  notifications: readonly KitNotification[],
  kind: K,
  inputs: CheckedRemovedKeyInputs,
): Extract<KitNotification, { readonly kind: K }>[] {
  return notifications.filter(
    (entry): entry is Extract<KitNotification, { readonly kind: K }> =>
      entry.kind === kind &&
      entry.at.removed !== true &&
      sameAddress(entry.account, inputs.account) &&
      sameAddress(entry.action, inputs.actionAddress),
  );
}

/** The notification sitting last in log order, if any. */
export function lastByPosition<N extends { readonly at: LogPosition }>(entries: readonly N[]): N | undefined {
  return entries.reduce<N | undefined>((last, entry) => (last === undefined || isLater(entry.at, last.at) ? entry : last), undefined);
}

/** The start of the highest-id consumed attempt that has one, the latest start by log order where an id repeats. */
export function latestConsumedStart(
  notifications: readonly KitNotification[],
  inputs: CheckedRemovedKeyInputs,
): Extract<KitNotification, { readonly kind: 'attempt-started' }> | undefined {
  const starts = ofKind(notifications, 'attempt-started', inputs);
  let highest: bigint | undefined;

  for (const consumed of ofKind(notifications, 'attempt-consumed', inputs)) {
    const started = starts.some((start) => start.attemptId === consumed.attemptId);

    if (started && (highest === undefined || consumed.attemptId > highest)) highest = consumed.attemptId;
  }

  if (highest === undefined) return undefined;

  return lastByPosition(starts.filter((start) => start.attemptId === highest));
}
