import type { Address, Ctx, Gathering, Hex } from '@kohaku-eth/social-recovery';
import { getAddress, hexToNumber } from 'viem';
import { connectionLine, signButton, traceBox, verdictLine } from './page';

/** The EIP-1193 surface the page calls on the injected wallet. */
export type InjectedWallet = {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(event: string, listener: (payload: unknown) => void): void;
};

/**
 * The cached connection; `session` grows on every reset, so a step that awaited across one drops its result.
 * `observedAccounts` / `observedChainIds` hold every account and chain the wallet reported since Connect last
 * started, the latest last, whether or not a connection is cached.
 */
export const state: {
  session: number; busy: boolean; listening: boolean;
  wallet?: InjectedWallet; guardian?: Address; chainId?: number; ctx?: Ctx; record?: Gathering;
  observedAccounts: (Address | undefined)[]; observedChainIds: number[];
} = { session: 0, busy: false, listening: false, observedAccounts: [], observedChainIds: [] };

export const injectedWallet = (): InjectedWallet | undefined =>
  (window as unknown as { ethereum?: InjectedWallet }).ethereum;

/** Drops the cached connection, request and verdict; Connect must run again. */
export function reset(reason?: string): void {
  Object.assign(state, { session: state.session + 1, guardian: undefined, chainId: undefined, ctx: undefined, record: undefined });
  signButton.disabled = true;
  connectionLine.textContent = '';
  verdictLine.textContent = reason === undefined ? '' : `${reason}: connect again`;
  traceBox.replaceChildren();
}

/** The first account of an EIP-1193 account list, checksummed; `undefined` when the list is empty. */
const firstAccount = (accounts: unknown): Address | undefined =>
  Array.isArray(accounts) && typeof accounts[0] === 'string' ? getAddress(accounts[0]) : undefined;

/** Records every account or chain the wallet reports; resets when it differs from the cached one. */
export function listen(wallet: InjectedWallet): void {
  if (state.listening || wallet.on === undefined) return;

  state.listening = true;
  wallet.on('accountsChanged', (accounts) => {
    const account = firstAccount(accounts);

    state.observedAccounts.push(account);

    if (state.guardian !== undefined && account !== state.guardian) reset('the wallet switched account');
  });
  wallet.on('chainChanged', (chain) => {
    const chainId = hexToNumber(chain as Hex);

    state.observedChainIds.push(chainId);

    if (state.chainId !== undefined && chainId !== state.chainId) reset('the wallet switched chain');
  });
}

/** Throws when a reset happened since `session` was read. */
export const ensureSession = (session: number): void => {
  if (session !== state.session) throw new Error('the wallet changed while this step ran; connect again');
};

/**
 * Asks for the account and the chain, reads both again (`eth_accounts`, `eth_chainId`), then caches them.
 * The listeners record what the wallet reports while these requests are pending; if a re-read or any
 * recorded value differs from what was requested, the state is cleared and the connection refused.
 * The wallet's permission-grant `accountsChanged` names the requested account, so it passes.
 */
export async function requestConnection(wallet: InjectedWallet, session: number): Promise<{ guardian: Address; chainId: number }> {
  Object.assign(state, { observedAccounts: [], observedChainIds: [] });

  const guardian = firstAccount(await wallet.request({ method: 'eth_requestAccounts' }));

  if (guardian === undefined) throw new Error('the wallet returned no account');

  const chainId = hexToNumber((await wallet.request({ method: 'eth_chainId' })) as Hex);
  const accountNow = firstAccount(await wallet.request({ method: 'eth_accounts' }));
  const chainNow = hexToNumber((await wallet.request({ method: 'eth_chainId' })) as Hex);

  ensureSession(session);

  const switched = accountNow !== guardian || chainNow !== chainId
    || state.observedAccounts.some((account) => account !== guardian)
    || state.observedChainIds.some((observed) => observed !== chainId);

  if (switched) {
    reset();
    throw new Error('the wallet switched account or chain while connecting; connect again');
  }

  Object.assign(state, { guardian, chainId });

  return { guardian, chainId };
}
