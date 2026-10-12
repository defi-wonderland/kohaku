import type { BlockHeader, BlockRange, BlockTag, FilterSpec, IProvider, ProviderRevert, RawLog, RawTransaction } from '@kohaku-eth/social-recovery';
import {
  type Address,
  BaseError,
  ExecutionRevertedError,
  type Hex,
  isHex,
  type PublicClient,
  RawContractError,
  toHex,
  TransactionNotFoundError,
} from 'viem';

/** viem's block selector for one SDK block tag. */
const at = (block: BlockTag): { blockNumber: bigint } | { blockTag: 'latest' | 'finalized' } =>
  typeof block === 'number' ? { blockNumber: BigInt(block) } : { blockTag: block };

/** The hex `data` one error of the chain carries, the node's revert bytes. */
const dataOf = (cause: unknown): Hex | undefined => {
  const data = typeof cause === 'object' && cause !== null && 'data' in cause ? cause.data : undefined;

  if (typeof data === 'string' && isHex(data)) return data;

  if (typeof data === 'object' && data !== null && 'data' in data && typeof data.data === 'string' && isHex(data.data)) return data.data;

  return undefined;
};

/** The raw revert bytes a failed `eth_call` carried, `0x` for an empty revert, or `undefined` where the failure was not a revert. */
function revertData(error: unknown): Hex | undefined {
  if (!(error instanceof BaseError)) return undefined;

  const reverted = error.walk((cause) => cause instanceof RawContractError || cause instanceof ExecutionRevertedError);

  if (reverted === null) return undefined;

  return dataOf(error.walk((cause) => dataOf(cause) !== undefined)) ?? '0x';
}

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
    blockNumber: Number(log.blockNumber),
    blockHash: log.blockHash,
    logIndex: Number(log.logIndex),
    transactionHash: log.transactionHash,
    ...(log.removed === undefined ? {} : { removed: log.removed }),
  };
}

/**
 * The SDK's chain access over one viem public client: one JSON-RPC request per read.
 * A reverted `eth_call` rejects with `{ data }`, the raw revert bytes; every other failure rejects as itself, never as an empty answer.
 */
export class ViemProvider implements IProvider {
  constructor(private readonly client: PublicClient) {}

  async chainId(): Promise<number> {
    return this.client.getChainId();
  }

  async call(to: Address, data: Hex, from: Address, block: BlockTag): Promise<Hex> {
    try {
      const result = await this.client.call({ to, data, account: from, ...at(block) });

      return result.data ?? '0x';
    } catch (error) {
      const reverted = revertData(error);

      if (reverted === undefined) throw error;

      const rejection: ProviderRevert = { data: reverted };

      throw rejection;
    }
  }

  async logs(filterSpec: FilterSpec, range: BlockRange): Promise<readonly RawLog[]> {
    const logs = (await this.client.request({
      method: 'eth_getLogs',
      params: [
        {
          address: [...filterSpec.address],
          topics: filterSpec.topics.map((topic) => (Array.isArray(topic) ? [...topic] : topic)) as Hex[],
          fromBlock: toHex(range.from),
          toBlock: toHex(range.to),
        },
      ],
    })) as unknown as readonly RpcLog[];

    return logs.map(rawLog);
  }

  async block(tag: BlockTag): Promise<BlockHeader> {
    const block = await this.client.getBlock(at(tag));

    if (block.number === null || block.hash === null) throw new Error(`block ${String(tag)} is pending`);

    return { number: Number(block.number), timestamp: Number(block.timestamp), hash: block.hash };
  }

  async code(address: Address, block: BlockTag): Promise<Hex> {
    return (await this.client.getCode({ address, ...at(block) })) ?? '0x';
  }

  async transaction(hash: Hex): Promise<RawTransaction | undefined> {
    try {
      const found = await this.client.getTransaction({ hash });

      if (found.blockNumber === null || found.blockHash === null) return undefined;

      return {
        hash: found.hash,
        from: found.from,
        to: found.to,
        input: found.input,
        blockNumber: Number(found.blockNumber),
        blockHash: found.blockHash,
      };
    } catch (error) {
      if (error instanceof TransactionNotFoundError) return undefined;

      throw error;
    }
  }
}
