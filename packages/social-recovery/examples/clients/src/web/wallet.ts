import type { Address, Hex } from '@kohaku-eth/social-recovery';
import { getAddress, hexToNumber } from 'viem';
import { connectionLine, statusLine } from './page';
import { SESSION_CHANGED_MESSAGE } from './provider';

/** Sepolia, the only chain the page runs against. */
export const SEPOLIA_CHAIN_ID = 11155111;

/** The EIP-1193 surface the page calls on the injected wallet. */
export type InjectedWallet = {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(event: string, listener: (payload: unknown) => void): void;
};

/** The connected wallet, its account and chain, and the session they were cached in. */
export type Connection = { readonly wallet: InjectedWallet; readonly account: Address; readonly chainId: number; readonly session: number };

/**
 * The cached connection; `session` grows on every reset, so a step that awaited across one drops its result.
 * `observedAccounts` / `observedChainIds` hold every account and chain the wallet reported since Connect last
 * started, the latest last, whether or not a connection is cached. `lastChainId` is the chain last observed or
 * connected to, kept across resets, so a chain switch while disconnected still drops what is bound to the chain.
 */
export const wallet: {
  session: number; listening: boolean; injected?: InjectedWallet; account?: Address; chainId?: number; lastChainId?: number;
  observedAccounts: (Address | undefined)[]; observedChainIds: number[];
} = { session: 0, listening: false, observedAccounts: [], observedChainIds: [] };

/** What a reset tells the rest of the page: whether the chain changed, which drops everything bound to it. */
export type ResetListener = (chainChanged: boolean) => void;

const resetListeners: ResetListener[] = [];

/** Registers a part of the page that drops its own cached results on a reset. */
export const onReset = (listener: ResetListener): void => {
  resetListeners.push(listener);
};

export const injectedWallet = (): InjectedWallet | undefined =>
  (window as unknown as { ethereum?: InjectedWallet }).ethereum;

/** Drops the cached connection; Connect must run again. The forms and pasted texts stay. */
export function reset(reason?: string, chainChanged = false): void {
  Object.assign(wallet, { session: wallet.session + 1, account: undefined, chainId: undefined });
  connectionLine.textContent = 'Not connected.';
  statusLine.textContent = reason === undefined ? '' : `${reason}: connect again`;

  for (const listener of resetListeners) listener(chainChanged);
}

/** The first account of an EIP-1193 account list, checksummed; `undefined` when the list is empty. */
const firstAccount = (accounts: unknown): Address | undefined =>
  Array.isArray(accounts) && typeof accounts[0] === 'string' ? getAddress(accounts[0]) : undefined;

/** Records every account or chain the wallet reports; resets when it differs from the cached one. */
export function listen(injected: InjectedWallet): void {
  if (wallet.listening || injected.on === undefined) return;

  wallet.listening = true;
  injected.on('accountsChanged', (accounts) => {
    const account = firstAccount(accounts);

    wallet.observedAccounts.push(account);

    if (wallet.account !== undefined && account !== wallet.account) reset('the wallet switched account');
  });
  injected.on('chainChanged', (chain) => {
    const chainId = hexToNumber(chain as Hex);

    const last = wallet.lastChainId;

    wallet.observedChainIds.push(chainId);
    wallet.lastChainId = chainId;

    if (last !== undefined && chainId !== last) reset('the wallet switched chain', true);
  });
}

/** Throws when a reset happened since `session` was read. */
export const ensureSession = (session: number): void => {
  if (session !== wallet.session) throw new Error(SESSION_CHANGED_MESSAGE);
};

/**
 * Asks for the account and the chain, reads both again (`eth_accounts`, `eth_chainId`), then caches them.
 * The listeners record what the wallet reports while these requests are pending; if a re-read or any
 * recorded value differs from what was requested, the connection is refused. A chain other than Sepolia is refused.
 */
export async function connect(injected: InjectedWallet): Promise<Connection> {
  reset();
  listen(injected);
  Object.assign(wallet, { observedAccounts: [], observedChainIds: [] });

  const { session } = wallet;
  const account = firstAccount(await injected.request({ method: 'eth_requestAccounts' }));

  ensureSession(session);

  if (account === undefined) throw new Error('the wallet returned no account');

  const chainId = hexToNumber((await injected.request({ method: 'eth_chainId' })) as Hex);

  ensureSession(session);

  const accountNow = firstAccount(await injected.request({ method: 'eth_accounts' }));

  ensureSession(session);

  const chainNow = hexToNumber((await injected.request({ method: 'eth_chainId' })) as Hex);

  ensureSession(session);

  const switched = accountNow !== account || chainNow !== chainId
    || wallet.observedAccounts.some((observed) => observed !== account)
    || wallet.observedChainIds.some((observed) => observed !== chainId);

  if (switched) {
    reset();
    throw new Error('the wallet switched account or chain while connecting; connect again');
  }

  if (chainId !== SEPOLIA_CHAIN_ID) throw new Error(`the wallet is on chain ${chainId}; switch it to Sepolia (${SEPOLIA_CHAIN_ID})`);

  Object.assign(wallet, { injected, account, chainId, lastChainId: chainId });
  connectionLine.textContent = `Connected ${account} on Sepolia (${chainId}).`;

  return { wallet: injected, account, chainId, session };
}

/** The connection cached now, read at the start of every action; throws when there is none. */
export function connected(): Connection {
  const { injected, account, chainId, session } = wallet;

  if (injected === undefined || account === undefined || chainId === undefined) throw new Error('connect the wallet first');

  return { wallet: injected, account, chainId, session };
}
