/** A value as indented JSON, bigints written as decimal strings with an `n` suffix. */
export const show = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : JSON.stringify(value, (_key, inner: unknown) => (typeof inner === 'bigint' ? `${inner}n` : inner), 2);

/** One step of a trace: the SDK call made and what it returned. */
export type Trace = (step: string, value?: unknown) => void;

/** A trace that prints to the console, each step on its own line and its value indented below. */
export const consoleTrace: Trace = (step, value) => {
  console.log(`\n> ${step}`);

  if (value !== undefined) console.log(show(value).replace(/^/gm, '  '));
};

/** Whether a method answered with a typed failure rather than bytes. */
export const isFailure = (value: unknown): value is { readonly kind: 'reply-failure'; readonly cause: string } =>
  typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'reply-failure';
