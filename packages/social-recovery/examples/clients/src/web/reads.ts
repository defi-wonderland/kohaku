import type { BlockHeader, BlockRange, BlockTag, FilterSpec, IProvider, RawLog, RawTransaction } from '@kohaku-eth/social-recovery';
import { type Address, createPublicClient, type Hex, http, type PublicClient } from 'viem';
import { sepolia } from 'viem/chains';
import { ViemProvider } from '../provider';
import type { NativeBalance } from '../validation';
import { holder } from './kit';
import { WALLET_ANSWER_MS } from './chain';
import { currentLifetime, ensureLive, timed } from './lifetime';
import { SESSION_CHANGED_MESSAGE, walletNativeBalance } from './provider';
import { type Connection, ensureSession } from './wallet';

/** An `IProvider` whose every read rejects when `session()` moved on while it ran, whatever the answer. */
export class SessionCheckedProvider implements IProvider {
  constructor(private readonly inner: IProvider, private readonly session: () => number) {}

  private async checked<T>(read: () => Promise<T>): Promise<T> {
    const before = this.session();
    let answer: T | undefined;
    let failure: unknown;
    let failed = false;

    try {
      answer = await read();
    } catch (error) {
      failed = true;
      failure = error;
    }

    if (this.session() !== before) throw new Error(SESSION_CHANGED_MESSAGE);

    if (failed) throw failure;

    return answer as T;
  }

  chainId(): Promise<number> {
    return this.checked(() => this.inner.chainId());
  }

  call(to: Address, data: Hex, from: Address, block: BlockTag): Promise<Hex> {
    return this.checked(() => this.inner.call(to, data, from, block));
  }

  logs(filterSpec: FilterSpec, range: BlockRange): Promise<readonly RawLog[]> {
    return this.checked(() => this.inner.logs(filterSpec, range));
  }

  block(tag: BlockTag): Promise<BlockHeader> {
    return this.checked(() => this.inner.block(tag));
  }

  code(address: Address, block: BlockTag): Promise<Hex> {
    return this.checked(() => this.inner.code(address, block));
  }

  transaction(hash: Hex): Promise<RawTransaction | undefined> {
    return this.checked(() => this.inner.transaction(hash));
  }
}

/** The form's Read RPC URL as an `http(s)` URL; throws on anything else. */
export function readRpcUrl(text: string): URL {
  let url: URL;

  try {
    url = new URL(text);
  } catch {
    throw new Error('the Read RPC URL is not a URL');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('the Read RPC URL must be http or https');

  return url;
}

/**
 * The scripts' viem `IProvider` over the Read RPC URL, session-checked, and the client it reads through. The transport
 * never retries and gives up within the read limit, so the page's own checks decide every request that goes out.
 */
export function readRpcProvider(url: URL, session: () => number): { provider: IProvider; client: PublicClient } {
  const transport = http(url.href, { retryCount: 0, timeout: WALLET_ANSWER_MS });
  const client = createPublicClient({ chain: sepolia, transport }) as PublicClient;

  return { client, provider: new SessionCheckedProvider(new ViemProvider(client), session) };
}

/** The native balance through the Read RPC URL when one is applied, else through the wallet. */
export function nativeBalanceFor(conn: Connection): NativeBalance {
  const client = holder.readClient;

  if (client === undefined) return walletNativeBalance(conn.wallet);

  const life = currentLifetime();

  return (address, blockNumber) => {
    ensureLive(life);

    return timed(client.getBalance({ address, blockNumber: BigInt(blockNumber) }), 'eth_getBalance', life);
  };
}

/** How often the page asks the Read RPC URL for its latest block while it catches up. */
const CATCH_UP_POLL_MS = 2000;

/** How long the page waits for the Read RPC URL to reach a block, the read limit. */
const CATCH_UP_LIMIT_MS = 60_000;

/**
 * Waits until the Read RPC URL's latest block is at least `block`, so checks after a mined transaction do not read a
 * state the endpoint has not seen yet; nothing to wait for without one. Throws when it is still behind after the limit.
 */
export async function readsAt(conn: Connection, block: number, limitMs = CATCH_UP_LIMIT_MS): Promise<void> {
  const client = holder.readClient;
  const life = currentLifetime();
  const deadline = Date.now() + limitMs;
  const remaining = (): number => deadline - Date.now();
  const late = (): Error => new Error(`the read endpoint has not reached block ${block} yet; Refresh later`);

  if (client === undefined) return;

  for (;;) {
    if (remaining() <= 0) throw late();

    ensureLive(life);

    const latest = await within(client.getBlockNumber({ cacheTime: 0 }), remaining(), late);

    if (remaining() <= 0) throw late();

    ensureLive(life);
    ensureSession(conn.session);

    if (latest >= BigInt(block)) return;

    if (remaining() <= 0) throw late();

    await new Promise((resolve) => setTimeout(resolve, Math.min(CATCH_UP_POLL_MS, remaining())));
    ensureSession(conn.session);
  }
}

/** `pending`, or the `late()` error once `ms` passed, whichever comes first. */
async function within<T>(pending: Promise<T>, ms: number, late: () => Error): Promise<T> {
  if (ms <= 0) throw late();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(late()), ms);
  });

  return Promise.race([pending, timeout]).finally(() => clearTimeout(timer));
}
