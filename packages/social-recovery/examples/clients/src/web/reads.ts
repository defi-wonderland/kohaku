import type { BlockHeader, BlockRange, BlockTag, FilterSpec, IProvider, RawLog, RawTransaction } from '@kohaku-eth/social-recovery';
import { type Address, createPublicClient, type Hex, http, type PublicClient } from 'viem';
import { sepolia } from 'viem/chains';
import { ViemProvider } from '../provider';
import type { NativeBalance } from '../validation';
import { holder } from './kit';
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

/** The scripts' viem `IProvider` over the Read RPC URL, session-checked, and the client it reads through. */
export function readRpcProvider(url: URL, session: () => number): { provider: IProvider; client: PublicClient } {
  const client = createPublicClient({ chain: sepolia, transport: http(url.href) }) as PublicClient;

  return { client, provider: new SessionCheckedProvider(new ViemProvider(client), session) };
}

/** The native balance through the Read RPC URL when one is applied, else through the wallet. */
export function nativeBalanceFor(conn: Connection): NativeBalance {
  const client = holder.readClient;

  if (client === undefined) return walletNativeBalance(conn.wallet);

  return (address, blockNumber) => client.getBalance({ address, blockNumber: BigInt(blockNumber) });
}

/** How often the page asks the Read RPC URL for its latest block while it catches up. */
const CATCH_UP_POLL_MS = 2000;

/** How long the page waits for the Read RPC URL to reach a block, the read limit. */
const CATCH_UP_LIMIT_MS = 60_000;

/**
 * Waits until the Read RPC URL's latest block is at least `block`, so checks after a mined transaction do not read a
 * state the endpoint has not seen yet; nothing to wait for without one. Throws when it is still behind after the limit.
 */
export async function readsAt(conn: Connection, block: number): Promise<void> {
  const client = holder.readClient;
  const started = Date.now();

  if (client === undefined) return;

  for (;;) {
    const latest = await client.getBlockNumber({ cacheTime: 0 });

    ensureSession(conn.session);

    if (latest >= BigInt(block)) return;

    if (Date.now() - started >= CATCH_UP_LIMIT_MS) throw new Error(`the read endpoint has not reached block ${block} yet; Refresh later`);

    await new Promise((resolve) => setTimeout(resolve, CATCH_UP_POLL_MS));
    ensureSession(conn.session);
  }
}
