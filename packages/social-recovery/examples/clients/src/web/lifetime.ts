import type { BlockHeader, BlockRange, BlockTag, FilterSpec, IProvider, RawLog, RawTransaction } from '@kohaku-eth/social-recovery';
import type { Address, Hex } from 'viem';
import { limitFor } from './chain';
import type { InjectedWallet } from './wallet';

/** One page action's lifetime: ended by a timeout or a reset of its own (`aborted`), or by the action settling. */
export type Lifetime = { aborted?: Error; settled: boolean };

/** The refusal of a request, or an answer, that came after its action settled. */
export const STEP_ENDED_MESSAGE = 'this step already ended; its late answer is dropped';

let current: Lifetime = { settled: true };
const endings = new WeakMap<Lifetime, AbortController>();

/** Starts an action with a fresh lifetime that no earlier callback can reach. */
export function beginAction(): Lifetime {
  current = { settled: false };

  return current;
}

/** Ends a lifetime once its action settled: its late answers are dropped and its late timers change nothing else. */
export const settleAction = (life: Lifetime): void => {
  life.settled = true;
  endings.get(life)?.abort(new Error(STEP_ENDED_MESSAGE));
};

/** The running action's lifetime, captured by every request that action issues. */
export const currentLifetime = (): Lifetime => current;

/** Ends one lifetime with `reason`; only that action's later requests refuse and it ends with the reason. */
export const abortAction = (reason: Error, life: Lifetime = current): void => {
  life.aborted ??= reason;
  endings.get(life)?.abort(life.aborted);
};

/** A signal that aborts once `life` is aborted or settled, with the reason it ended. */
export function endedSignal(life: Lifetime): AbortSignal {
  let ending = endings.get(life);

  if (ending === undefined) {
    ending = new AbortController();
    endings.set(life, ending);
  }

  if (life.aborted !== undefined || life.settled) ending.abort(life.aborted ?? new Error(STEP_ENDED_MESSAGE));

  return ending.signal;
}

/** Throws when `life` was aborted or already settled, so nothing more is asked, written or accepted for it. */
export function ensureLive(life: Lifetime = current): void {
  if (life.aborted !== undefined) throw life.aborted;

  if (life.settled) throw new Error(STEP_ENDED_MESSAGE);
}

/** Who answers a timed request: the connected wallet, or the Read RPC URL. */
export type Answerer = 'wallet' | 'read-endpoint';

/** What a request says when its answerer let the limit pass, in seconds. */
export const LATE_MESSAGES: Readonly<Record<Answerer, (method: string, seconds: number) => string>> = {
  wallet: (method, seconds) => `the wallet did not answer ${method} within ${seconds} s; open the wallet, or reload the page and connect again`,
  'read-endpoint': (method, seconds) => `the read endpoint did not answer ${method} within ${seconds} s; check the Read RPC URL or try again`,
};

/**
 * A request issued for `life` that rejects, naming the method and its limit, when it is not answered in time; the
 * timeout aborts only `life`, and its message names `answerer`. An answer is accepted only while `life` is still live.
 */
export async function timed<T>(
  pending: Promise<T>,
  method: string,
  life: Lifetime,
  answerer: Answerer = 'wallet',
  ms = limitFor(method),
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(LATE_MESSAGES[answerer](method, ms / 1000));

      abortAction(error, life);
      reject(error);
    }, ms);
  });
  const answer = await Promise.race([pending, timeout]).finally(() => clearTimeout(timer));

  ensureLive(life);

  return answer;
}

/** The wallet as one action uses it: each request refused once that action ended, then timed for it. */
export const lifetimeWallet = (injected: InjectedWallet, life: Lifetime): InjectedWallet => ({
  request: (args) => {
    ensureLive(life);

    return timed(injected.request(args), args.method, life);
  },
});

/** An `IProvider` bound to one action: every read refused once that action ended, timed as `answerer`'s and aborting only it. */
export class LifetimeProvider implements IProvider {
  constructor(
    private readonly inner: IProvider,
    private readonly life: Lifetime,
    private readonly answerer: Answerer = 'wallet',
  ) {}

  private read<T>(method: string, run: () => Promise<T>): Promise<T> {
    ensureLive(this.life);

    return timed(run(), method, this.life, this.answerer);
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
