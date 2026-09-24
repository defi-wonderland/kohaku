import type { AbiEvent } from 'viem';
import type { Hex } from '../interfaces';
import type { OwnedEvent } from '../types';

/** The entry whose topic0 equals the log's first topic in lower case, or nothing. */
export const byTopic0 = <Event extends AbiEvent>(
  events: readonly OwnedEvent<Event>[],
  topic: Hex | undefined,
): OwnedEvent<Event> | undefined => {
  if (topic === undefined) return undefined;

  const wanted = topic.toLowerCase();

  return events.find((entry) => entry.topic0 === wanted);
};
