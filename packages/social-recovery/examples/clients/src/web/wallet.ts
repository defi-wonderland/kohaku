import type { Address, Hex } from '@kohaku-eth/social-recovery';
import { getAddress, hexToNumber } from 'viem';
import { abortAction, type Ask, ensureLive, SEPOLIA_CHAIN_ID, switchToSepolia, timed, timedWallet, wrongChain } from './chain';
import { note } from '../trace';
import { connectionLine, statusLine } from './page';
import { SESSION_CHANGED_MESSAGE } from './provider';

export { SEPOLIA_CHAIN_ID } from './chain';

/** The EIP-1193 surface the page calls on the injected wallet. */
export type InjectedWallet = {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(event: string, listener: (payload: unknown) => void): void;
  removeListener?(event: string, listener: (payload: unknown) => void): void;
};

/** The connected wallet, its account and chain, and the session they were cached in. */
export type Connection = { readonly wallet: InjectedWallet; readonly account: Address; readonly chainId: number; readonly session: number };

/**
 * The cached connection; `session` grows on every reset, so a step that awaited across one drops its result.
 * `observedAccounts` / `observedChainIds` hold every account and chain the wallet reported since Connect last
 * started, the latest last, whether or not a connection is cached. `lastChainId` is the chain last observed or
 * connected to, kept across resets, so a chain switch while disconnected still drops what is bound to the chain.
 * `requestedChainId` is the chain a running Connect asked the wallet to switch to; the switch's own event does not reset.
 */
export const wallet: {
  session: number; listenedTo?: InjectedWallet; injected?: InjectedWallet; account?: Address; chainId?: number; lastChainId?: number;
  requestedChainId?: number; observedAccounts: (Address | undefined)[]; observedChainIds: number[];
} = { session: 0, observedAccounts: [], observedChainIds: [] };

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
  note(reason === undefined ? '⟲ connection dropped' : `⟲ connection dropped: ${reason}`);
  connectionLine.textContent = 'Not connected.';
  statusLine.textContent = reason === undefined ? '' : `${reason}: connect again`;

  for (const listener of resetListeners) listener(chainChanged);
}

/** A reset the wallet's own event caused, which also ends the running action. */
function dropBy(reason: string, chainChanged: boolean): void {
  abortAction(new Error(`${SESSION_CHANGED_MESSAGE} (${reason})`));
  reset(reason, chainChanged);
}

/** The first account of an EIP-1193 account list, checksummed; `undefined` when the list is empty. */
const firstAccount = (accounts: unknown): Address | undefined =>
  Array.isArray(accounts) && typeof accounts[0] === 'string' ? getAddress(accounts[0]) : undefined;

function onAccounts(accounts: unknown): void {
  const account = firstAccount(accounts);

  wallet.observedAccounts.push(account);

  if (wallet.account !== undefined && account !== wallet.account) dropBy(`the wallet switched account to ${account ?? 'none'}`, false);
}

function onChain(chain: unknown): void {
  const chainId = hexToNumber(chain as Hex);
  const last = wallet.lastChainId;

  wallet.observedChainIds.push(chainId);
  wallet.lastChainId = chainId;

  if (last !== undefined && chainId !== last && chainId !== wallet.requestedChainId) dropBy(`the wallet switched chain to ${chainId}`, true);
}

/** Records every account or chain the wallet reports, moving the listeners when the page's wallet object changed. */
export function listen(injected: InjectedWallet): void {
  if (wallet.listenedTo === injected || injected.on === undefined) return;

  wallet.listenedTo?.removeListener?.('accountsChanged', onAccounts);
  wallet.listenedTo?.removeListener?.('chainChanged', onChain);
  wallet.listenedTo = injected;
  injected.on('accountsChanged', onAccounts);
  injected.on('chainChanged', onChain);
}

/** Throws when a reset happened since `session` was read. */
export const ensureSession = (session: number): void => {
  if (session !== wallet.session) throw new Error(SESSION_CHANGED_MESSAGE);
};

/**
 * Asks for the account, switches the wallet to Sepolia when it is elsewhere, reads the account and the chain again
 * (`eth_accounts`, `eth_chainId`), then caches them. Each request waits at most `limitFor(method)`. The listeners
 * record what the wallet reports meanwhile; a re-read or a recorded value that differs from what was expected (the
 * first chain before the switch, Sepolia after it) refuses the connection, as does a wallet left on another chain.
 */
export async function connect(injected: InjectedWallet): Promise<Connection> {
  try {
    return await connectOnce(injected);
  } finally {
    wallet.requestedChainId = undefined;
  }
}

async function connectOnce(injected: InjectedWallet): Promise<Connection> {
  reset();
  listen(injected);
  Object.assign(wallet, { observedAccounts: [], observedChainIds: [] });

  const { session } = wallet;
  const live = (): void => ensureSession(session);
  const ask: Ask = async (method, params) => {
    live();
    ensureLive();
    statusLine.textContent = 'Connecting… confirm in your wallet';

    let answer: unknown;

    try {
      answer = await timed(injected.request(params === undefined ? { method } : { method, params }), method);
    } catch (error) {
      live();
      throw error;
    }

    live();

    return answer;
  };
  const account = firstAccount(await ask('eth_requestAccounts'));

  ensureSession(session);

  if (account === undefined) throw new Error('the wallet returned no account');

  const first = hexToNumber((await ask('eth_chainId')) as Hex);

  ensureSession(session);

  const mark = wallet.observedChainIds.length;

  if (first !== SEPOLIA_CHAIN_ID) {
    wallet.requestedChainId = SEPOLIA_CHAIN_ID;
    await switchToSepolia(ask, first, live);
    ensureSession(session);
  }

  const chainId = hexToNumber((await ask('eth_chainId')) as Hex);

  ensureSession(session);

  if (chainId !== SEPOLIA_CHAIN_ID) throw wrongChain(chainId);

  const accountNow = firstAccount(await ask('eth_accounts'));

  ensureSession(session);

  const chainNow = hexToNumber((await ask('eth_chainId')) as Hex);

  ensureSession(session);

  const switched = accountNow !== account || chainNow !== chainId
    || wallet.observedAccounts.some((observed) => observed !== account)
    || wallet.observedChainIds.slice(0, mark).some((observed) => observed !== first)
    || wallet.observedChainIds.slice(mark).some((observed) => observed !== chainId);

  if (switched) {
    reset();
    throw new Error('the wallet switched account or chain while connecting; connect again');
  }

  const timedInjected = timedWallet(injected);

  Object.assign(wallet, { injected: timedInjected, account, chainId, lastChainId: chainId });
  connectionLine.textContent = `Connected ${account} on Sepolia (${chainId}).`;
  statusLine.textContent = 'Connected.';

  return { wallet: timedInjected, account, chainId, session };
}

/** The connection cached now, read at the start of every action; throws when there is none. */
export function connected(): Connection {
  const { injected, account, chainId, session } = wallet;

  if (injected === undefined || account === undefined || chainId === undefined) throw new Error('connect the wallet first');

  return { wallet: injected, account, chainId, session };
}
