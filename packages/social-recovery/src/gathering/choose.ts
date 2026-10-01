import type { SetupBody } from '../types';
import type { FiledPlace } from '../types/gathering';
import { clausePlaces } from './edge';

/** Every way to pick `size` items from `items`, in order. */
function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) {
    return [[]];
  }

  return items.flatMap((item, index) => combinations(items.slice(index + 1), size - 1).map((rest) => [item, ...rest]));
}

/** Per clause the earliest-filed places among the allowed ones, as many as its threshold; undefined where a clause falls short. */
function earliest(body: SetupBody, filled: ReadonlyMap<number, FiledPlace>, allowed: (entry: FiledPlace) => boolean): FiledPlace[] | undefined {
  const chosen: FiledPlace[] = [];

  for (const { threshold, places } of clausePlaces(body)) {
    const pool = places
      .map((place) => filled.get(place))
      .filter((entry): entry is FiledPlace => entry !== undefined && allowed(entry))
      .sort((left, right) => left.filedAt - right.filedAt);

    if (pool.length < threshold) {
      return undefined;
    }

    chosen.push(...pool.slice(0, threshold));
  }

  return chosen;
}

/** Whether `left` was filed earlier than `right`, comparing their ascending filing positions in turn. */
function filedEarlier(left: readonly FiledPlace[], right: readonly FiledPlace[]): boolean {
  const leftOrder = left.map((entry) => entry.filedAt).sort((a, b) => a - b);
  const rightOrder = right.map((entry) => entry.filedAt).sort((a, b) => a - b);
  const differs = leftOrder.findIndex((position, index) => position !== rightOrder[index]);

  return differs !== -1 && (leftOrder[differs] ?? 0) < (rightOrder[differs] ?? 0);
}

/**
 * The preferred satisfying set among the filled places, or undefined where none satisfies:
 * no stopped method where such a set exists and stops reach the setup, then the smallest set,
 * then the fewest distinct stoppable methods, then the earliest filed replies.
 */
export function preferredSet(body: SetupBody, filled: ReadonlyMap<number, FiledPlace>): FiledPlace[] | undefined {
  const avoidsStopped = (entry: FiledPlace): boolean => body.ignoresPause || entry.entry.standing !== 'stopped';
  const unstopped = earliest(body, filled, avoidsStopped) !== undefined;
  const inPool = (entry: FiledPlace): boolean => !unstopped || avoidsStopped(entry);
  const stoppable = [
    ...new Set([...filled.values()].filter((entry) => inPool(entry) && entry.entry.stoppable).map((entry) => entry.entry.method.toLowerCase())),
  ];

  for (let size = 0; size <= stoppable.length; size++) {
    let best: FiledPlace[] | undefined;

    for (const methods of combinations(stoppable, size)) {
      const named = new Set(methods);
      const candidate = earliest(
        body,
        filled,
        (entry) => inPool(entry) && (!entry.entry.stoppable || named.has(entry.entry.method.toLowerCase())),
      );

      if (candidate !== undefined && (best === undefined || filedEarlier(candidate, best))) {
        best = candidate;
      }
    }

    if (best !== undefined) {
      return best;
    }
  }

  return undefined;
}
