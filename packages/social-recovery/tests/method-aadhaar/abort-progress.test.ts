import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Hex, Material } from '../../src/interfaces';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import { jsDocOf, REPO_ROOT, SRC_ROOT } from '../helpers/source';
import type { Stack } from './fixtures';
import { CERTIFICATE, clockForFile, configBytes, ctxFor, FRESH_NOW, isFailure, pcdOf, QR_DATA, signalsFor, SYNTHETIC_UPSTREAM } from './fixtures';

type Progress = Parameters<Stack['prove']>[1];
type Pcd = Awaited<ReturnType<Stack['prove']>>;

/** The proof vector's digest. */
const DIGEST: Hex = '0x17498ba208aefe001e6e2f2adec41cd16d0285e23660df6e310d3daac040c339';
const PARAMS = { nullifierSeed: 77n, issuerCertificate: CERTIFICATE };
const ctx = ctxFor(configBytes(22n, 77n), DIGEST);
const boundPcd = pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 77n, DIGEST));
const BOUND_MS = 200;
const TIMED_OUT: unique symbol = Symbol('timed out');

clockForFile(FRESH_NOW);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The value, or `TIMED_OUT` when it does not settle within `ms`. */
const within = <T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> =>
  Promise.race([work, sleep(ms).then((): typeof TIMED_OUT => TIMED_OUT)]);

type SteppedStack = {
  readonly stack: Stack;
  /** Resolves once `prove` has been entered. */
  readonly proving: Promise<void>;
  /** Calls the callback the stack received, as the installed stack reports a state over time. */
  readonly emit: (state: string) => void;
  /** Settles the pending `prove` with a proof. */
  readonly finish: (pcd: Pcd) => void;
  readonly received: () => Progress;
  readonly signals: (AbortSignal | undefined)[];
  readonly verifyCalls: () => number;
  /** Whether `prove` has settled. */
  readonly settled: () => boolean;
};

/** A stack whose `prove` stays pending until the test finishes it and reports states only when the test emits them. */
function steppedStack(): SteppedStack {
  let received: Progress;
  let settle: (pcd: Pcd) => void = () => undefined;
  let entered: () => void = () => undefined;
  let done = false;
  let verifies = 0;
  const signals: (AbortSignal | undefined)[] = [];
  const proving = new Promise<void>((resolve) => {
    entered = resolve;
  });

  const stack: Stack = {
    generateArgs: () => Promise.resolve({ circuitArguments: 'from the stepped stack' }),
    prove: (_args, onProgress, signal) => {
      received = onProgress;
      signals.push(signal);
      entered();

      return new Promise<Pcd>((resolve) => {
        settle = (pcd) => {
          done = true;
          resolve(pcd);
        };
      });
    },
    verify: () => {
      verifies += 1;

      return Promise.resolve(true);
    },
  };

  return {
    stack,
    proving,
    emit: (state) => received?.(state),
    finish: (pcd) => settle(pcd),
    received: () => received,
    signals,
    verifyCalls: () => verifies,
    settled: () => done,
  };
}

/** The page's progress callback and the states it saw. */
function page(): { readonly onProgress: (state: string) => void; readonly states: string[] } {
  const states: string[] = [];

  return {
    onProgress: (state) => {
      states.push(state);
    },
    states,
  };
}

let unhandled = 0;
const countUnhandled = (): void => {
  unhandled += 1;
};

beforeEach(() => {
  unhandled = 0;
  process.on('unhandledRejection', countUnhandled);
});

afterEach(() => {
  process.off('unhandledRejection', countUnhandled);
});

type Run = (stack: Stack, material: Material) => Promise<unknown>;

const RUNS: readonly (readonly [string, Run])[] = [
  [
    'replyFrom',
    (stack, material) => {
      const method = anonAadhaarMethod({ stack });

      return method.replyFrom(ctx, method.signingInput(ctx, PARAMS), material);
    },
  ],
  [
    'configFrom',
    (stack, material) => {
      const method = anonAadhaarMethod({ stack });

      return method.configFrom(method.enrollInput(PARAMS), material);
    },
  ],
];

describe('an aborted proof forwards no more progress', () => {
  it.each(RUNS)('%s: the states before the abort reach the page, none after it', async (_name, run) => {
    const stepped = steppedStack();
    const controller = new AbortController();
    const seen = page();
    const pending = run(stepped.stack, { qrData: QR_DATA, onProgress: seen.onProgress, signal: controller.signal });

    await stepped.proving;
    stepped.emit('fetching-wasm');
    stepped.emit('fetching-zkey');
    controller.abort();
    stepped.emit('proving');
    stepped.emit('completed');

    expect(isFailure(await within(pending, BOUND_MS), 'device-refused')).toBe(true);
    expect(seen.states).toEqual(['fetching-wasm', 'fetching-zkey']);
  });

  it.each(RUNS)('%s settles device-refused at once while the stack\'s prove is still pending', async (_name, run) => {
    const stepped = steppedStack();
    const controller = new AbortController();
    const pending = run(stepped.stack, { qrData: QR_DATA, onProgress: page().onProgress, signal: controller.signal });

    await stepped.proving;
    controller.abort();

    const result = await within(pending, BOUND_MS);

    expect(result).not.toBe(TIMED_OUT);
    expect(isFailure(result, 'device-refused')).toBe(true);
    expect(stepped.settled()).toBe(false);
  });

  it.each(RUNS)('%s ignores the stack\'s later proof and its later states: still device-refused, no verify, nothing more on the page', async (_name, run) => {
    const stepped = steppedStack();
    const controller = new AbortController();
    const seen = page();
    const pending = run(stepped.stack, { qrData: QR_DATA, onProgress: seen.onProgress, signal: controller.signal });

    await stepped.proving;
    stepped.emit('proving');
    controller.abort();

    const result = await within(pending, BOUND_MS);

    stepped.emit('completed');
    stepped.finish(boundPcd);
    await sleep(20);

    expect(isFailure(result, 'device-refused')).toBe(true);
    expect(isFailure(await pending, 'device-refused')).toBe(true);
    expect(seen.states).toEqual(['proving']);
    expect(stepped.verifyCalls()).toBe(0);
    expect(unhandled).toBe(0);
  });

  it.each(RUNS)('%s: the stack receives the signal and a callback of its own, which forwards to the page while the signal is live', async (_name, run) => {
    const stepped = steppedStack();
    const controller = new AbortController();
    const seen = page();
    const pending = run(stepped.stack, { qrData: QR_DATA, onProgress: seen.onProgress, signal: controller.signal });

    await stepped.proving;

    expect(stepped.signals).toEqual([controller.signal]);
    expect(stepped.received()).toEqual(expect.any(Function));
    expect(stepped.received()).not.toBe(seen.onProgress);

    stepped.emit('proving');
    stepped.emit('completed');
    stepped.finish(boundPcd);

    expect(typeof (await within(pending, BOUND_MS))).toBe('string');
    expect(seen.states).toEqual(['proving', 'completed']);
  });
});

/** A signal whose `aborted` getter reads false until `explode` is called, then throws on every read. */
function explodingSignal(): { readonly signal: AbortSignal; readonly explode: () => void } {
  let exploded = false;
  const signal = {
    get aborted(): boolean {
      if (exploded) throw new Error('aborted getter exploded');

      return false;
    },
    addEventListener(): void {},
    removeEventListener(): void {},
  } as unknown as AbortSignal;

  return {
    signal,
    explode: () => {
      exploded = true;
    },
  };
}

describe('a signal whose getter throws during the proof', () => {
  it.each(RUNS)('%s forwards nothing once the getter throws and settles material-rejected', async (_name, run) => {
    const stepped = steppedStack();
    const { signal, explode } = explodingSignal();
    const seen = page();
    const pending = run(stepped.stack, { qrData: QR_DATA, onProgress: seen.onProgress, signal });

    await stepped.proving;
    stepped.emit('fetching-wasm');
    explode();
    stepped.emit('proving');
    stepped.emit('completed');
    stepped.finish(boundPcd);

    const result = await within(pending, BOUND_MS);

    expect(isFailure(result, 'material-rejected')).toBe(true);
    expect(seen.states).toEqual(['fetching-wasm']);
    await sleep(20);
    expect(unhandled).toBe(0);
  });

  it.each(RUNS)('%s: a getter throwing from the first read forwards nothing and asks no stack', async (_name, run) => {
    const stepped = steppedStack();
    const { signal, explode } = explodingSignal();
    const seen = page();

    explode();

    const result = await within(run(stepped.stack, { qrData: QR_DATA, onProgress: seen.onProgress, signal }), BOUND_MS);

    expect(isFailure(result, 'material-rejected')).toBe(true);
    expect(seen.states).toEqual([]);
    expect(stepped.signals).toEqual([]);
  });
});

describe('the abort contract, documented where the page and an injected stack read it', () => {
  const TYPES = join(SRC_ROOT, 'types', 'method-aadhaar.ts');

  it('the material\'s signal says an abort is device-refused at once, that the SDK starts no worker and that the stack runs on', () => {
    const doc = jsDocOf(TYPES, 'signal', 'AadhaarMaterial');

    expect(doc).toContain('device-refused');
    expect(doc).toMatch(/no worker/i);
    expect(doc).toMatch(/progress/i);
  });

  it('the stack\'s prove says the installed stack runs on after an abort and an injected one may stop on the signal', () => {
    const doc = jsDocOf(TYPES, 'prove', 'AnonAadhaarStack');

    expect(doc).toMatch(/abort/i);
    expect(doc).toMatch(/injected/i);
  });
});

describe('the abort contract\'s changeset', () => {
  const text = readFileSync(join(REPO_ROOT, '.changeset', 'aadhaar-abort-contract.md'), 'utf8');

  it('is a patch for the package that states what an abort stops and carries a Compatibility line', () => {
    expect(text).toMatch(/^---\n"@kohaku-eth\/social-recovery": patch\n---\n/);
    expect(text).toContain('device-refused');
    expect(text).toMatch(/no worker/i);
    expect(text).toContain('Compatibility');
    expect(text).not.toMatch(/^\s*(\*\*)?breaking/im);
  });
});
