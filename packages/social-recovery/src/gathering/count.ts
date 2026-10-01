import { decodeSetupBody } from '../formats/setup-body';
import type { Assessment, Gathering, Moment, RequestWindowBounds } from '../interfaces';
import { windowFindings } from '../validation/window';
import { assertGatheringRead, clausePlaces, windowFactsOf } from './edge';
import { clauseCounts, satisfies } from './rule';

/** The places a filed reply fills, ascending, among those the body names. */
export function filledPlaces(record: Gathering, total: number): number[] {
  const places = new Set(record.replies.map((reply) => reply.place).filter((place) => Number.isInteger(place) && place >= 0 && place < total));

  return [...places].sort((left, right) => left - right);
}

/**
 * The record's progress: filled and missing places, each clause's count, whether the rule is satisfied,
 * and the request findings the window and the moment reach. Throws on a record this build does not read.
 */
export function count(record: Gathering, now: Moment, bounds: RequestWindowBounds): Assessment {
  assertGatheringRead(record);

  const body = decodeSetupBody(record.request.setupBody);
  const total = clausePlaces(body).flatMap((clause) => clause.places).length;
  const filled = filledPlaces(record, total);
  const filledSet = new Set(filled);
  const clauses = clauseCounts(body, filledSet);
  const { errors, warnings } = windowFindings(windowFactsOf(record), now, bounds);

  return {
    filled,
    missing: Array.from({ length: total }, (_, place) => place).filter((place) => !filledSet.has(place)),
    clauses,
    ruleSatisfied: satisfies(clauses),
    findings: [...errors, ...warnings],
  };
}
