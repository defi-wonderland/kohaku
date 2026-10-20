import type {
  Address,
  BlockHeader,
  BlockRange,
  BlockTag,
  FilterSpec,
  Hex,
  IProvider,
  ProviderRevert,
  RawLog,
  RawTransaction,
} from '@kohaku-eth/social-recovery';
import { hexToBigInt, hexToNumber, toHex } from 'viem';
import type { NativeBalance } from '../validation';
import { revertData } from './revert';
import { SESSION_CHANGED_MESSAGE } from './chain';
import type { InjectedWallet } from './wallet';

export { SESSION_CHANGED_MESSAGE } from './chain';

/** The JSON-RPC block parameter of one SDK block tag: a number as a hex quantity, a named tag as itself. */
export const blockParam = (block: BlockTag): string => (typeof block === 'number' ? toHex(block) : block);

type RpcLog = {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly blockNumber: Hex | null;
  readonly blockHash: Hex | null;
  readonly logIndex: Hex | null;
  readonly transactionHash: Hex | null;
  readonly removed?: boolean;
};

function rawLog(log: RpcLog): RawLog {
  if (log.blockNumber === null || log.blockHash === null || log.logIndex === null || log.transactionHash === null) {
    throw new Error('eth_getLogs returned a pending log');
  }

  return {
    address: log.address,
    topics: log.topics,
    data: log.data,
    blockNumber: hexToNumber(log.blockNumber),
    blockHash: log.blockHash,
    logIndex: hexToNumber(log.logIndex),
    transactionHash: log.transactionHash,
    ...(log.removed === undefined ? {} : { removed: log.removed }),
  };
}

type RpcBlock = { readonly number: Hex | null; readonly hash: Hex | null; readonly timestamp: Hex };

type RpcTransaction = {
  readonly hash: Hex;
  readonly from: Address;
  readonly to: Address | null;
  readonly input: Hex;
  readonly blockNumber: Hex | null;
  readonly blockHash: Hex | null;
};

/**
 * The SDK's chain access through the injected wallet: one EIP-1193 request per read, no RPC URL of the page's own.
 * A confirmed revert of `eth_call` rejects with `{ data }`, the raw revert bytes; every other failure rejects as itself.
 * A read the wallet answered after `session()` moved on rejects, whatever the answer, so no SDK call runs on past a switch.
 */
export class WalletProvider implements IProvider {
  constructor(private readonly wallet: InjectedWallet, private readonly session: () => number = () => 0) {}

  private async request<T>(method: string, params: readonly unknown[]): Promise<T> {
    const before = this.session();
    let answer: unknown;
    let failure: unknown;
    let failed = false;

    try {
      answer = await this.wallet.request({ method, params });
    } catch (error) {
      failed = true;
      failure = error;
    }

    if (this.session() !== before) throw new Error(SESSION_CHANGED_MESSAGE);

    if (failed) throw failure;

    return answer as T;
  }

  async chainId(): Promise<number> {
    return hexToNumber(await this.request<Hex>('eth_chainId', []));
  }

  async call(to: Address, data: Hex, from: Address, block: BlockTag): Promise<Hex> {
    try {
      return (await this.request<Hex | null>('eth_call', [{ from, to, data }, blockParam(block)])) ?? '0x';
    } catch (error) {
      const reverted = revertData(error);

      if (reverted === undefined) throw error;

      const rejection: ProviderRevert = { data: reverted };

      throw rejection;
    }
  }

  async logs(filterSpec: FilterSpec, range: BlockRange): Promise<readonly RawLog[]> {
    const filter = {
      address: [...filterSpec.address],
      topics: filterSpec.topics.map((topic) => (Array.isArray(topic) ? [...topic] : topic)),
      fromBlock: toHex(range.from),
      toBlock: toHex(range.to),
    };

    return (await this.request<readonly RpcLog[]>('eth_getLogs', [filter])).map(rawLog);
  }

  async block(tag: BlockTag): Promise<BlockHeader> {
    const block = await this.request<RpcBlock | null>('eth_getBlockByNumber', [blockParam(tag), false]);

    if (block === null) throw new Error(`block ${String(tag)} is unknown to the node`);

    if (block.number === null || block.hash === null) throw new Error(`block ${String(tag)} is pending`);

    return { number: hexToNumber(block.number), timestamp: hexToNumber(block.timestamp), hash: block.hash };
  }

  async code(address: Address, block: BlockTag): Promise<Hex> {
    return (await this.request<Hex | null>('eth_getCode', [address, blockParam(block)])) ?? '0x';
  }

  async transaction(hash: Hex): Promise<RawTransaction | undefined> {
    const found = await this.request<RpcTransaction | null>('eth_getTransactionByHash', [hash]);

    if (found === null || found.blockNumber === null || found.blockHash === null) return undefined;

    return {
      hash: found.hash,
      from: found.from,
      to: found.to,
      input: found.input,
      blockNumber: hexToNumber(found.blockNumber),
      blockHash: found.blockHash,
    };
  }
}

/** The native balance through the wallet's `eth_getBalance` at a block number, the read the `IProvider` lacks. */
export const walletNativeBalance = (wallet: InjectedWallet): NativeBalance => async (address, blockNumber) =>
  hexToBigInt((await wallet.request({ method: 'eth_getBalance', params: [address, toHex(blockNumber)] })) as Hex);
