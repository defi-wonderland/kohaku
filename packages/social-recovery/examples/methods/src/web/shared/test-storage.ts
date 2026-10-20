/** The prefix of every `localStorage` key the testing modes write: what is kept under it is a TEST-ONLY key. */
const TEST_ONLY_PREFIX = 'methods-playground TEST-ONLY ';

const memory = new Map<string, string>();

/** The value kept under the TEST-ONLY key, from `localStorage` where the page may use it, else from this page's memory. */
export function readTestOnly(name: string): string | undefined {
  try {
    return globalThis.localStorage?.getItem(TEST_ONLY_PREFIX + name) ?? memory.get(name);
  } catch {
    return memory.get(name);
  }
}

/** Keeps the value under the TEST-ONLY key, in `localStorage` where the page may use it and in this page's memory. */
export function writeTestOnly(name: string, value: string): void {
  memory.set(name, value);

  try {
    globalThis.localStorage?.setItem(TEST_ONLY_PREFIX + name, value);
  } catch {
    // Storage refused (private mode, a Node probe): the memory copy serves this page only.
  }
}

/** The value kept under the name, made and kept first when there is none. */
export const testOnly = (name: string, make: () => string): string => {
  const kept = readTestOnly(name);

  if (kept !== undefined) return kept;

  const made = make();

  writeTestOnly(name, made);

  return made;
};
