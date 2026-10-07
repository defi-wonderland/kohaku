import { FORMATS_SAFE_INTEGER_BITS } from '../constants';
import { assertUintNumber, sameAddress } from '../formats/guards';
import { NOTIFICATION_KINDS } from '../interfaces';
import type { KitNotification, LogPosition } from '../interfaces';
import type { CheckedRemovedKeyInputs, RemovedKeyNotification } from '../types/removed-key';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null;

/** Whether the value is a non-negative safe integer, as a block number or log index must be. */
function isPositionNumber(value: unknown): boolean {
  try {
    assertUintNumber(value, FORMATS_SAFE_INTEGER_BITS, 'position');

    return true;
  } catch {
    return false;
  }
}

/** Whether one entry of a log read is a declared notification kind with a sound position, and for a handover kind the fields the selection reads. */
function isWellFormed(entry: unknown): boolean {
  if (!isRecord(entry) || !isRecord(entry['at'])) return false;

  const { kind, at } = entry;

  if (!(NOTIFICATION_KINDS as readonly unknown[]).includes(kind)) return false;

  if (!isPositionNumber(at['blockNumber']) || !isPositionNumber(at['logIndex'])) return false;

  if (kind !== 'setup-committed' && kind !== 'attempt-started' && kind !== 'attempt-consumed') return true;

  if (typeof entry['account'] !== 'string' || typeof entry['action'] !== 'string') return false;

  if (kind === 'setup-committed') return typeof at['transactionHash'] === 'string' && typeof at['blockHash'] === 'string';

  return typeof entry['attemptId'] === 'bigint' && (kind === 'attempt-consumed' || typeof entry['payload'] === 'string');
}

/** Whether a log read's answer is a dense array of well-formed notifications; a hole counts as malformed. */
export function isWellFormedAnswer(answer: unknown): answer is readonly KitNotification[] {
  if (!Array.isArray(answer)) return false;

  for (let index = 0; index < answer.length; index += 1) {
    if (!(index in answer) || !isWellFormed(answer[index])) return false;
  }

  return true;
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
