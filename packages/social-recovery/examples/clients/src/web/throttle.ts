import type { BlockHeader, BlockRange, BlockTag, FilterSpec, IProvider, RawLog, RawTransaction } from '@kohaku-eth/social-recovery';
import type { Address, Hex } from 'viem';
import { note } from '../trace';
import { ensureLive, type Lifetime } from './lifetime';

/** The most requests the page keeps in flight to the Read RPC URL at once; the rest wait their turn in order. */
export const READ_CONCURRENCY = 2;

/** The waits before each retry of a rate-limited read, in order; after the last, the error stands. */
export const RATE_LIMIT_BACKOFF_MS: readonly number[] = [500, 1000, 2000, 4000];

/** A read endpoint's words for a request it refused for its rate or size limit. */
export const RATE_LIMITED = /rate limit|exceeds defined limit|too many requests/i;

/** The HTTP status of a rate-limited request. */
const TOO_MANY_REQUESTS = 429;

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

/** Whether an error, or any error in its `cause` chain, is the endpoint's rate limit. */
export function isRateLimited(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 8 && typeof current === 'object' && current !== null; depth += 1) {
    const fields = current as { status?: unknown; message?: unknown; details?: unknown; shortMessage?: unknown; cause?: unknown };
    const words = [fields.message, fields.details, fields.shortMessage].filter((entry) => typeof entry === 'string').join(' ');

    if (fields.status === TOO_MANY_REQUESTS || RATE_LIMITED.test(words)) return true;

    current = fields.cause;
  }

  return false;
}

/**
 * Runs one read against the Read RPC URL inside the concurrency cap, retrying it after each backoff wait while the
 * endpoint answers with its rate limit. Any other error fails at once; `life` ending stops the retries.
 */
export async function throttled<T>(run: () => Promise<T>, life: Lifetime): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    ensureLive(life);

    const release = await slot();
    let wait: number | undefined;

    try {
      ensureLive(life);

      return await run();
    } catch (error) {
      wait = RATE_LIMIT_BACKOFF_MS[attempt];

      if (!isRateLimited(error) || wait === undefined) throw error;
    } finally {
      release();
    }

    ensureLive(life);
    note(`read endpoint rate-limited, retrying in ${wait} ms`);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/** An `IProvider` whose every read goes through `throttled` for one action's lifetime. */
export class ThrottledProvider implements IProvider {
  constructor(private readonly inner: IProvider, private readonly life: Lifetime) {}

  chainId(): Promise<number> {
    return throttled(() => this.inner.chainId(), this.life);
  }

  call(to: Address, data: Hex, from: Address, block: BlockTag): Promise<Hex> {
    return throttled(() => this.inner.call(to, data, from, block), this.life);
  }

  logs(filterSpec: FilterSpec, range: BlockRange): Promise<readonly RawLog[]> {
    return throttled(() => this.inner.logs(filterSpec, range), this.life);
  }

  block(tag: BlockTag): Promise<BlockHeader> {
    return throttled(() => this.inner.block(tag), this.life);
  }

  code(address: Address, block: BlockTag): Promise<Hex> {
    return throttled(() => this.inner.code(address, block), this.life);
  }

  transaction(hash: Hex): Promise<RawTransaction | undefined> {
    return throttled(() => this.inner.transaction(hash), this.life);
  }
}
