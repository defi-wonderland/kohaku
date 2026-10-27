import { KitRefusalError, type ValidationResult } from '@kohaku-eth/social-recovery';

/** JSON with bigints as decimal strings, for printing records. */
export const show = (value: unknown): string =>
  JSON.stringify(value, (_key, entry: unknown) => (typeof entry === 'bigint' ? entry.toString() : entry), 2);

/** Where the trace's lines go; `failed` marks a failure's lines. */
export type TraceSink = (line: string, failed: boolean) => void;

let sink: TraceSink = (line, failed) => (failed ? console.error(line) : console.log(line));

/** Sends every later trace line to `next` instead of the console. */
export function setTraceSink(next: TraceSink): void {
  sink = next;
}

/** One SDK call or flow step, printed as it starts. */
export function step(label: string): void {
  sink(`\n▶ ${label}`, false);
}

/** One line under the current step. */
export function note(label: string, value?: unknown): void {
  if (value === undefined) {
    sink(`  ${label}`, false);

    return;
  }

  const text = typeof value === 'string' ? value : show(value);

  sink(`  ${label}: ${text.includes('\n') ? text.replace(/\n/g, '\n  ') : text}`, false);
}

/** Prints a validation result's errors and warnings by code. */
export function findings(result: ValidationResult): void {
  for (const error of result.errors) note(`error ${error.code}`, error.values);

  for (const warning of result.warnings) note(`warning ${warning.code}`, warning.values);

  if (result.errors.length === 0 && result.warnings.length === 0) note('no findings');
}

/** Throws where a condition the flow relies on does not hold. */
export function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);

  note(`ok: ${message}`);
}

/** Prints a failure, with the findings a `KitRefusalError` carries. */
export function failure(error: unknown): void {
  sink('\n✗ failed', true);

  if (error instanceof KitRefusalError) {
    sink(`  KitRefusalError: ${error.message}`, true);

    if (error.findings !== undefined) findings(error.findings);

    if (error.restoreCause !== undefined) note('restore cause', error.restoreCause);

    return;
  }

  sink(error instanceof Error ? `  ${error.stack ?? error.message}` : `  ${show(error)}`, true);
}
