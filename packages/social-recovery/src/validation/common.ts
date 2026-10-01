import { normalizeAddress } from '../formats/guards';
import type {
  Address,
  ErrorCode,
  FindingSubject,
  FindingValues,
  ValidationError,
  ValidationResult,
  ValidationWarning,
  WarningCode,
} from '../interfaces';

/** The findings one judgment collects, appended to as each check runs. */
export type Findings = {
  readonly errors: ValidationError[];
  readonly warnings: ValidationWarning[];
};

/** An empty collection. */
export const emptyFindings = (): Findings => ({ errors: [], warnings: [] });

/** Appends one error. */
export function addError(findings: Findings, code: ErrorCode, subject: FindingSubject, values: FindingValues): void {
  findings.errors.push({ code, subject, values });
}

/** Appends one warning. */
export function addWarning(findings: Findings, code: WarningCode, subject: FindingSubject, values: FindingValues): void {
  findings.warnings.push({ code, subject, values });
}

/** Appends another result's findings in their order. */
export function addAll(findings: Findings, result: ValidationResult): void {
  findings.errors.push(...result.errors);
  findings.warnings.push(...result.warnings);
}

/** Refuses anything but an array. */
export function assertArray(value: unknown, name: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
}

/** The checksummed spellings of a list of addresses, refusing a malformed entry. */
export function normalizeAddresses(values: readonly Address[], name: string): Address[] {
  assertArray(values, name);

  return values.map((value, index) => normalizeAddress(value, `${name}[${index}]`));
}
