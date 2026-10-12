import { KitRefusalError, type ValidationResult } from '@kohaku-eth/social-recovery';
import { pathToFileURL } from 'node:url';

/** JSON with bigints as decimal strings, for printing records. */
export const show = (value: unknown): string =>
  JSON.stringify(value, (_key, entry: unknown) => (typeof entry === 'bigint' ? entry.toString() : entry), 2);

/** One SDK call or flow step, printed as it starts. */
export function step(label: string): void {
  console.log(`\n▶ ${label}`);
}

/** One line under the current step. */
export function note(label: string, value?: unknown): void {
  if (value === undefined) {
    console.log(`  ${label}`);

    return;
  }

  const text = typeof value === 'string' ? value : show(value);

  console.log(`  ${label}: ${text.includes('\n') ? text.replace(/\n/g, '\n  ') : text}`);
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
  console.error('\n✗ failed');

  if (error instanceof KitRefusalError) {
    console.error(`  KitRefusalError: ${error.message}`);

    if (error.findings !== undefined) findings(error.findings);

    if (error.restoreCause !== undefined) note('restore cause', error.restoreCause);

    return;
  }

  console.error(error instanceof Error ? `  ${error.stack ?? error.message}` : `  ${show(error)}`);
}

/** Runs a script's entry when its module is the one Node was started with, exiting 1 on any failure. */
export function runIfMain(moduleUrl: string, entry: () => Promise<void>): void {
  const started = process.argv[1];

  if (started === undefined || pathToFileURL(started).href !== moduleUrl) return;

  entry().then(
    () => process.exit(0),
    (error: unknown) => {
      failure(error);
      process.exit(1);
    },
  );
}
