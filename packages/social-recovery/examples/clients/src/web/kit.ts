import {
  AmbireActionCodec,
  AmbireRecoveryAction,
  type DeploymentDescriptor,
  EventManager,
  type Gathering,
  type IRecoveryClient,
  type MethodRegistry,
  PolicyManager,
  RecoveryClient,
  SetupClient,
  walletMethod,
} from '@kohaku-eth/social-recovery';
import type { Address } from 'viem';
import type { HolderAccount } from '../account';
import type { Kit } from '../clients';
import { signerRecovery } from '../signer-recovery';
import { note, show, step } from '../trace';
import { BLOCK_TAGS, clientConfiguration } from './config';
import { accountLine, button, stateOut } from './page';
import type { WalletProvider } from './provider';
import { type Connection, onReset, settled } from './wallet';

/**
 * What the holder panel cached: the checked deployment, the chosen account and the kit over it, the open gathering
 * and whether the waiting attempt is ripe. A chain switch drops all of it; an account switch keeps it, so the person
 * can sign as a guardian and come back to the same gathering.
 */
export const holder: {
  descriptor?: DeploymentDescriptor; provider?: WalletProvider; account?: HolderAccount; kit?: Kit;
  gathering?: Gathering; ripe: boolean;
} = { ripe: false };

onReset((chainChanged) => {
  holder.ripe = false;
  button('execute').disabled = true;

  if (!chainChanged) return;

  Object.assign(holder, { descriptor: undefined, provider: undefined, account: undefined, kit: undefined, gathering: undefined });
  accountLine.textContent = 'The chain changed: apply the deployment again.';
});

/** Builds the parts in the merged constructors' order over the wallet provider, then both clients over the same parts. */
export function buildKit(provider: WalletProvider, descriptor: DeploymentDescriptor, account: HolderAccount, key: Address): Kit {
  const { action } = descriptor;
  const codec = new AmbireActionCodec([action]);
  const policyManager = new PolicyManager(provider, descriptor, account.address, action, BLOCK_TAGS);
  const recoveryAction = new AmbireRecoveryAction(provider, descriptor, account.address, action, codec, BLOCK_TAGS);
  const method = walletMethod();
  const methods: MethodRegistry = new Map([[descriptor.methodEcdsa, method]]);
  const events = new EventManager(provider, descriptor, account.address, action, methods, { logChunkSize: 10000 });
  const configuration = clientConfiguration(key, account.creation);
  const setup = new SetupClient(
    provider, descriptor, account.address, action, configuration, 'integrator',
    policyManager, recoveryAction, events, methods, codec, signerRecovery,
  );
  const recovery: IRecoveryClient = new RecoveryClient(
    provider, descriptor, account.address, action, configuration,
    policyManager, recoveryAction, events, methods, codec, signerRecovery,
  );

  return { descriptor, configuration, policyManager, recoveryAction, codec, events, method, setup, recovery };
}

/** Caches the chosen account and its kit, naming the connected key as the one candidate key. */
export function useAccount(conn: Connection, account: HolderAccount): Kit {
  const { descriptor, provider } = holder;

  if (descriptor === undefined || provider === undefined) throw new Error('apply the deployment first');

  const kit = buildKit(provider, descriptor, account, conn.account);

  step('clients');
  note('account', account.address);
  note('candidate key (the connected account)', conn.account);
  Object.assign(holder, { account, kit, gathering: undefined, ripe: false });
  accountLine.textContent = `Account ${account.address}${account.sendsSelfCalls ? '' : ' (EOA stand-in: reads and prepares only)'}.`;

  return kit;
}

/** The cached kit, provider and account; throws until an account is chosen. */
export function requireKit(): { kit: Kit; provider: WalletProvider; account: HolderAccount } {
  const { kit, provider, account } = holder;

  if (kit === undefined || provider === undefined || account === undefined) throw new Error('apply the deployment and choose an account first');

  return { kit, provider, account };
}

/** Reads `setupState()` and `recoveryState()` and prints both, bigints as decimal strings. */
export async function refreshState(conn: Connection): Promise<void> {
  const { kit } = requireKit();

  step('setupState / recoveryState');

  const setupState = await settled(conn.session, kit.setup.setupState());
  const recoveryState = await settled(conn.session, kit.recovery.recoveryState());

  note('setupState', setupState);
  note('recoveryState', recoveryState);
  stateOut.textContent = `read as ${conn.account}\nsetupState ${show(setupState)}\nrecoveryState ${show(recoveryState)}`;
}
