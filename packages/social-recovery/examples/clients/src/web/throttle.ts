import type { BlockHeader, BlockRange, BlockTag, FilterSpec, IProvider, RawLog, RawTransaction } from '@kohaku-eth/social-recovery';
import type { Address, Hex } from 'viem';
import { note } from '../trace';
import { WALLET_ANSWER_MS } from './chain';
import { dispatchFor, TOO_MANY_REQUESTS } from './endpoint';
import { abortAction, ensureLive, LATE_MESSAGES, type Lifetime } from './lifetime';

/** The most requests the page keeps in flight to the Read RPC URL at once; the rest wait their turn in order. */
export const READ_CONCURRENCY = 2;

/** The waits before each retry of a rate-limited read, in order; after the last, the error stands. */
export const RATE_LIMIT_BACKOFF_MS: readonly number[] = [500, 1000, 2000, 4000];

/** A read endpoint's words for a request it refused for its rate or size limit. */
export const RATE_LIMITED = /rate limit|exceeds defined limit|too many requests/i;

/** How a read is named in its timeout when its caller names no method. */
const UNNAMED_READ = 'a read';

/** When one read must be done by, as a `Date.now()` time, and the error its action ends with once that time passed. */
export type ReadBound = { readonly deadline: number; readonly late: () => Error };

/** The bound of a read of `method` starting now: the read limit, then the read endpoint's timeout error. */
export const readBound = (method: string, limitMs = WALLET_ANSWER_MS): ReadBound => ({
  deadline: Date.now() + limitMs,
  late: () => new Error(LATE_MESSAGES['read-endpoint'](method, limitMs / 1000)),
});

let inFlight = 0;
const waiting: (() => void)[] = [];

/** Takes one of the `READ_CONCURRENCY` slots, waiting in order for one; resolves to its release. */
async function slot(): Promise<() => void> {
  if (inFlight < READ_CONCURRENCY) inFlight += 1;
  else await new Promise<void>((resolve) => waiting.push(resolve));

  let released = false;

  return () => {
    if (released) return;

    released = true;

    const next = waiting.shift();

    if (next === undefined) inFlight -= 1;
    else next();
  };
}

/** Whether an error, or any error in its `cause` chain, is the endpoint's rate limit; a cycle in the chain ends the walk. */
export function isRateLimited(error: unknown): boolean {
  const seen = new Set<object>();

  for (let current: unknown = error; typeof current === 'object' && current !== null && !seen.has(current); ) {
    seen.add(current);

    const fields = current as { status?: unknown; message?: unknown; details?: unknown; shortMessage?: unknown; cause?: unknown };
    const words = [fields.message, fields.details, fields.shortMessage].filter((entry) => typeof entry === 'string').join(' ');

    if (fields.status === TOO_MANY_REQUESTS || RATE_LIMITED.test(words)) return true;

    current = fields.cause;
  }

  return false;
}

const remaining = (bound: ReadBound): number => Math.max(0, bound.deadline - Date.now());

/** Ends `life` with the bound's error and throws its reason. */
function expire(bound: ReadBound, life: Lifetime): never {
  abortAction(bound.late(), life);
  ensureLive(life);
  throw bound.late();
}

/** Throws when `life` ended, ending it with the bound's error first once the deadline passed. */
function ensureBefore(bound: ReadBound, life: Lifetime): void {
  if (remaining(bound) === 0) expire(bound, life);

  ensureLive(life);
}

/** A slot taken before the deadline; one granted after it is handed straight on and the read expires. */
async function slotBefore(bound: ReadBound, life: Lifetime): Promise<() => void> {
  const granted = slot();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), remaining(bound));
  });
  const release = await Promise.race([granted, late]).finally(() => clearTimeout(timer));

  if (release !== undefined) return release;

  void granted.then((free) => free());

  return expire(bound, life);
}

/** Sends one attempt; the deadline passing ends `life`, which aborts the request, so the attempt settles. */
async function attemptBefore<T>(run: () => Promise<T>, bound: ReadBound, life: Lifetime): Promise<T> {
  const timer = setTimeout(() => abortAction(bound.late(), life), remaining(bound));

  dispatchFor(life);

  try {
    return await run();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs one read against the Read RPC URL inside the concurrency cap, retrying it after each backoff wait while the
 * endpoint answers with its rate limit. Any other error fails at once; `life` ending stops the retries. Nothing is
 * sent, and no answer accepted, once `bound`'s deadline passed: the action then ends with the bound's error. A slot is
 * released only once its attempt settled.
 */
export async function throttled<T>(run: () => Promise<T>, life: Lifetime, bound = readBound(UNNAMED_READ)): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    ensureBefore(bound, life);

    const release = await slotBefore(bound, life);
    let answer: { value: T } | undefined;
    let failure: unknown;

    try {
      ensureBefore(bound, life);
      answer = { value: await attemptBefore(run, bound, life) };
    } catch (error) {
      failure = error;
    } finally {
      release();
    }

    ensureBefore(bound, life);

    if (answer !== undefined) return answer.value;

    const wait = RATE_LIMIT_BACKOFF_MS[attempt];

    if (!isRateLimited(failure) || wait === undefined) throw failure;

    note(`read endpoint rate-limited, retrying in ${wait} ms`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait, remaining(bound))));
  }
}

/** An `IProvider` whose every read goes through `throttled` for one action's lifetime, each bounded by `limitMs`. */
export class ThrottledProvider implements IProvider {
  constructor(private readonly inner: IProvider, private readonly life: Lifetime, private readonly limitMs = WALLET_ANSWER_MS) {}

  private read<T>(method: string, run: () => Promise<T>): Promise<T> {
    return throttled(run, this.life, readBound(method, this.limitMs));
  }

  chainId(): Promise<number> {
    return this.read('eth_chainId', () => this.inner.chainId());
  }

  call(to: Address, data: Hex, from: Address, block: BlockTag): Promise<Hex> {
    return this.read('eth_call', () => this.inner.call(to, data, from, block));
  }

  logs(filterSpec: FilterSpec, range: BlockRange): Promise<readonly RawLog[]> {
    return this.read('eth_getLogs', () => this.inner.logs(filterSpec, range));
  }

  block(tag: BlockTag): Promise<BlockHeader> {
    return this.read('eth_getBlockByNumber', () => this.inner.block(tag));
  }

  code(address: Address, block: BlockTag): Promise<Hex> {
    return this.read('eth_getCode', () => this.inner.code(address, block));
  }

  transaction(hash: Hex): Promise<RawTransaction | undefined> {
    return this.read('eth_getTransactionByHash', () => this.inner.transaction(hash));
  }
}
