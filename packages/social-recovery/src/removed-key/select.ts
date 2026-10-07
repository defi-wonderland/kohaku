import type { KitNotification, LogPosition } from '../interfaces';
import { sameAddress } from '../formats/guards';
import type { CheckedRemovedKeyInputs, RemovedKeyNotification } from '../types/removed-key';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null;

/** Whether one entry of a log read carries what the selection reads: a kind and a position, and for a handover kind its fields. */
export function isWellFormed(entry: unknown): boolean {
  if (!isRecord(entry) || typeof entry['kind'] !== 'string' || !isRecord(entry['at'])) return false;

  const { kind, at } = entry;

  if (kind !== 'setup-committed' && kind !== 'attempt-started' && kind !== 'attempt-consumed') return true;

  const positioned =
    typeof entry['account'] === 'string' &&
    typeof entry['action'] === 'string' &&
    typeof at['blockNumber'] === 'number' &&
    typeof at['logIndex'] === 'number';

  if (kind === 'setup-committed') return positioned && typeof at['transactionHash'] === 'string' && typeof at['blockHash'] === 'string';

  return positioned && typeof entry['attemptId'] === 'bigint' && (kind === 'attempt-consumed' || typeof entry['payload'] === 'string');
}

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
