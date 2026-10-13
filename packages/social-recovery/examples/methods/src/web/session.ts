import type { Address, Ctx, Gathering, Hex } from '@kohaku-eth/social-recovery';
import { getAddress, hexToNumber } from 'viem';
import { connectionLine, signButton, traceBox, verdictLine } from './page';

/** The EIP-1193 surface the page calls on the injected wallet. */
export type InjectedWallet = {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(event: string, listener: (payload: unknown) => void): void;
};

/** The cached connection; `session` grows on every reset, so a step that awaited across one drops its result. */
export const state: {
  session: number; busy: boolean; listening: boolean;
  wallet?: InjectedWallet; guardian?: Address; chainId?: number; ctx?: Ctx; record?: Gathering;
} = { session: 0, busy: false, listening: false };

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

/** Resets when the wallet reports an account or chain other than the cached one. */
export function listen(wallet: InjectedWallet): void {
  if (state.listening || wallet.on === undefined) return;

  state.listening = true;
  wallet.on('accountsChanged', (accounts) => {
    if (state.guardian !== undefined && firstAccount(accounts) !== state.guardian) reset('the wallet switched account');
  });
  wallet.on('chainChanged', (chain) => {
    if (state.chainId !== undefined && hexToNumber(chain as Hex) !== state.chainId) reset('the wallet switched chain');
  });
}

/** Throws when a reset happened since `session` was read. */
export const ensureSession = (session: number): void => {
  if (session !== state.session) throw new Error('the wallet changed while this step ran; connect again');
};

/**
 * Asks for the account and the chain, then reads both again (`eth_accounts`, `eth_chainId`).
 * The listeners only guard a cached connection, so a switch while a request was pending is caught here:
 * if either differs from what was requested, the state is cleared and the connection refused.
 */
export async function requestConnection(wallet: InjectedWallet, session: number): Promise<{ guardian: Address; chainId: number }> {
  const guardian = firstAccount(await wallet.request({ method: 'eth_requestAccounts' }));

  if (guardian === undefined) throw new Error('the wallet returned no account');

  const chainId = hexToNumber((await wallet.request({ method: 'eth_chainId' })) as Hex);
  const accountNow = firstAccount(await wallet.request({ method: 'eth_accounts' }));
  const chainNow = hexToNumber((await wallet.request({ method: 'eth_chainId' })) as Hex);

  ensureSession(session);

  if (accountNow !== guardian || chainNow !== chainId) {
    reset();
    throw new Error('the wallet switched account or chain while connecting; connect again');
  }

  return { guardian, chainId };
}
