import { type Account, type Address, createPublicClient, createWalletClient, http, isAddressEqual, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { holderAccount, type HolderAccount } from './account';
import { buildKit, deploymentDescriptor, type HolderKeys, type Kit } from './clients';
import { type Env, loadEnv } from './env';
import { ViemProvider } from './provider';

/** Everything one flow run uses: the environment, the chain access, the account, the kit and the signing wallets. */
export type Session = {
  readonly env: Env;
  readonly client: PublicClient;
  readonly provider: ViemProvider;
  readonly account: HolderAccount;
  readonly kit: Kit;
  readonly holders: HolderKeys;
  readonly sponsor: WalletClient & { readonly account: Account };
  /** The wallet of the key the account holds now. */
  readonly holder: WalletClient & { readonly account: Account };
};

const walletOf = (env: Env, key: `0x${string}`): WalletClient & { readonly account: Account } =>
  createWalletClient({ account: privateKeyToAccount(key), chain: sepolia, transport: http(env.rpcUrl) });

/** Opens a session from the environment, reading the chain once to check the descriptor and name the holder key. */
export async function openSession(given?: Env): Promise<Session> {
  const env = given ?? loadEnv();
  const client = createPublicClient({ chain: sepolia, transport: http(env.rpcUrl) }) as PublicClient;
  const provider = new ViemProvider(client);
  const sponsor = walletOf(env, env.sponsorKey);
  const first = privateKeyToAccount(env.holderKey).address;
  const second = privateKeyToAccount(env.newHolderKey).address;
  const descriptor = await deploymentDescriptor(env, provider);
  const account = await holderAccount(env, provider, client, sponsor, first);
  const { kit, holders } = await buildKit(provider, descriptor, env, account.address, { current: first, next: second }, account.creation);
  const holderKey = isAddressEqual(holders.current, first) ? env.holderKey : env.newHolderKey;

  return { env, client, provider, account, kit, holders, sponsor, holder: walletOf(env, holderKey) };
}

/** The sponsor's address, the `from` every permissionless prepare simulates from. */
export const sponsorAddress = (session: Session): Address => session.sponsor.account.address;
