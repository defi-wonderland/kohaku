import type { Hex } from '@kohaku-eth/social-recovery';
import { hexToNumber } from 'viem';
import { type Ask, SEPOLIA_CHAIN_ID, switchToSepolia, wrongChain } from './chain';
import { currentLifetime, lifetimeWallet, timed } from './lifetime';
import { connectionLine, statusLine } from './page';
import { type Connection, ensureSession, firstAccount, type InjectedWallet, listen, reset, wallet } from './wallet';

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
  const life = currentLifetime();
  const live = (): void => ensureSession(session);
  const ask: Ask = async (method, params) => {
    live();
    statusLine.textContent = 'Connecting… confirm in your wallet';

    let answer: unknown;

    try {
      answer = await timed(injected.request(params === undefined ? { method } : { method, params }), method, life);
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

  Object.assign(wallet, { injected, account, chainId, lastChainId: chainId });
  connectionLine.textContent = `Connected ${account} on Sepolia (${chainId}).`;
  statusLine.textContent = 'Connected.';

  return { wallet: lifetimeWallet(injected, life), account, chainId, session };
}
