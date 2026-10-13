import { pathToFileURL } from 'node:url';
import { failure } from './trace';

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
