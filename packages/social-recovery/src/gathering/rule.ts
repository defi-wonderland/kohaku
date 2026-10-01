import type { ClauseCount } from '../interfaces';
import type { SetupBody } from '../types';
import { clausePlaces } from './edge';

/** Each clause's threshold beside how many of its places the given set fills. */
export function clauseCounts(body: SetupBody, filled: ReadonlySet<number>): ClauseCount[] {
  return clausePlaces(body).map(({ threshold, places }, clause) => ({
    clause,
    threshold,
    filled: places.filter((place) => filled.has(place)).length,
  }));
}

/** Whether every clause meets its threshold, false for no clauses and for a rule whose every threshold is zero. */
export function satisfies(counts: readonly ClauseCount[]): boolean {
  return (
    counts.length > 0 &&
    counts.some((count) => count.threshold > 0) &&
    counts.every((count) => count.filled >= count.threshold)
  );
}
