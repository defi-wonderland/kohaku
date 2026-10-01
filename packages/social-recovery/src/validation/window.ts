import { FORMATS_SAFE_INTEGER_BITS, FORMATS_VALID_UNTIL_BITS, VALIDATION_MOMENT_SKEW_SECONDS } from '../constants';
import { assertObject, assertUintNumber } from '../formats/guards';
import type { Moment, RequestWindowBounds, ValidationError, ValidationResult, ValidationWarning } from '../interfaces';
import type { WindowFacts } from '../types/validation';

/** Refuses window facts, a moment or bounds that are not non-negative safe integers. */
function assertWindowInputs(facts: WindowFacts, moment: Moment, bounds: RequestWindowBounds): void {
  assertObject(facts, 'facts');
  assertObject(bounds, 'bounds');
  assertUintNumber(facts.validUntil, FORMATS_VALID_UNTIL_BITS, 'facts.validUntil');
  assertUintNumber(facts.blockTimestamp, FORMATS_SAFE_INTEGER_BITS, 'facts.blockTimestamp');
  assertUintNumber(moment, FORMATS_SAFE_INTEGER_BITS, 'moment');
  assertUintNumber(bounds.floor, FORMATS_SAFE_INTEGER_BITS, 'bounds.floor');

  if (facts.consumableAfter !== undefined) {
    assertUintNumber(facts.consumableAfter, FORMATS_VALID_UNTIL_BITS, 'facts.consumableAfter');
  }
}

/** The window's width in seconds from the pinned block's timestamp to its deadline, negative once the deadline is behind it. */
export const requestWindowWidth = (facts: WindowFacts): number => facts.validUntil - facts.blockTimestamp;

/**
 * The findings a request window reaches from its own values, the moment and the client's window bounds alone:
 * `request.expired` once the moment is past `validUntil`, `request.window-short` under `bounds.floor`,
 * `request.moment-skew` past `VALIDATION_MOMENT_SKEW_SECONDS` from the block's timestamp, and
 * `cancel.window-late` where a cancellation's window ends after `consumableAfter`.
 * Throws a TypeError or RangeError on a malformed argument and never on a finding.
 */
export function windowFindings(facts: WindowFacts, moment: Moment, bounds: RequestWindowBounds): ValidationResult {
  assertWindowInputs(facts, moment, bounds);

  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const { validUntil, blockTimestamp, consumableAfter } = facts;
  const window = requestWindowWidth(facts);

  if (moment > validUntil) {
    errors.push({ code: 'request.expired', subject: 'request', values: { validUntil, moment } });
  }

  if (window < bounds.floor) {
    warnings.push({ code: 'request.window-short', subject: 'request', values: { window, floor: bounds.floor } });
  }

  if (Math.abs(moment - blockTimestamp) > VALIDATION_MOMENT_SKEW_SECONDS) {
    warnings.push({
      code: 'request.moment-skew',
      subject: 'request',
      values: { moment, blockTimestamp, span: VALIDATION_MOMENT_SKEW_SECONDS },
    });
  }

  if (consumableAfter !== undefined && validUntil > consumableAfter) {
    warnings.push({ code: 'cancel.window-late', subject: 'request', values: { validUntil, consumableAfter } });
  }

  return { errors, warnings };
}
