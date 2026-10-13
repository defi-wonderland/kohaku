import { toHex } from 'viem';

/** Sepolia, the only chain the page runs against. */
export const SEPOLIA_CHAIN_ID = 11155111;

/** Sepolia's chain id as the wallet methods take it. */
export const SEPOLIA_CHAIN_HEX = toHex(SEPOLIA_CHAIN_ID);

/** Sepolia as `wallet_addEthereumChain` takes it, for a wallet that does not know the chain yet. */
export const SEPOLIA_CHAIN_PARAMS = {
  chainId: SEPOLIA_CHAIN_HEX,
  chainName: 'Sepolia',
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
  blockExplorerUrls: ['https://sepolia.etherscan.io'],
} as const;

/** How long Connect waits for the wallet to answer one request before saying so. */
export const WALLET_ANSWER_MS = 60_000;

/** The EIP-1193 code of a request the user rejected. */
const USER_REJECTED = 4001;

/** The EIP-3326 code of a switch to a chain the wallet does not know. */
const CHAIN_UNKNOWN = 4902;

/** Asks the wallet one request; the page's wrapper adds the timeout and the session check. */
export type Ask = (method: string, params?: readonly unknown[]) => Promise<unknown>;

/** The EIP-1193 code of an error, or of the wallet's original error nested under `data`. */
function codeOf(error: unknown): unknown {
  const record = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
  const outer = record(error);
  const nested = record(record(outer?.['data'])?.['originalError']);

  return outer?.['code'] === CHAIN_UNKNOWN || nested?.['code'] === CHAIN_UNKNOWN ? CHAIN_UNKNOWN : outer?.['code'];
}

/** The refusal Connect gives a wallet that stays on another chain. */
export const wrongChain = (chainId: number): Error =>
  new Error(`the wallet is on chain ${chainId}; switch it to Sepolia (${SEPOLIA_CHAIN_ID})`);

/**
 * Asks the wallet to switch to Sepolia (`wallet_switchEthereumChain`); a wallet that does not know the chain (4902)
 * is asked to add it (`wallet_addEthereumChain`) and to switch again. The user's rejection (4001) refuses with the
 * wrong-chain message; any other failure rejects as itself.
 */
export async function switchToSepolia(ask: Ask, from: number): Promise<void> {
  try {
    await ask('wallet_switchEthereumChain', [{ chainId: SEPOLIA_CHAIN_HEX }]);
  } catch (error) {
    const code = codeOf(error);

    if (code === USER_REJECTED) throw wrongChain(from);

    if (code !== CHAIN_UNKNOWN) throw error;

    await ask('wallet_addEthereumChain', [SEPOLIA_CHAIN_PARAMS]);
    await ask('wallet_switchEthereumChain', [{ chainId: SEPOLIA_CHAIN_HEX }]).catch((again: unknown) => {
      throw codeOf(again) === USER_REJECTED ? wrongChain(from) : again;
    });
  }
}

/** A wallet request that rejects, naming the method, when the wallet has not answered within `ms`. */
export function timed<T>(pending: Promise<T>, method: string, ms = WALLET_ANSWER_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`the wallet did not answer ${method} within ${ms / 1000} s; open the wallet, or reload the page and connect again`)), ms);
  });

  return Promise.race([pending, timeout]).finally(() => clearTimeout(timer));
}
