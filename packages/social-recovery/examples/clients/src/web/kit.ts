import type { DeploymentDescriptor, Gathering, IProvider } from '@kohaku-eth/social-recovery';
import { type Address, isAddressEqual, type PublicClient } from 'viem';
import type { HolderAccount } from '../account';
import { assembleKit, assembleParts, type Kit } from '../clients';
import { note, show, step } from '../trace';
import { BLOCK_TAGS, clientConfiguration, tokenAllowlist, WEB_LOG_CHUNK_SIZE } from './config';
import { accountLine, button, stateOut } from './page';
import { currentLifetime } from './lifetime';
import { bindProvider } from './reads';
import { type Connection, ensureSession, onReset } from './wallet';

/**
 * What the holder panel cached: the checked deployment, the chosen account and the kit over it, the open gathering
 * and whether the waiting attempt is ripe. A chain switch drops all of it; an account switch keeps it, so the person
 * can sign as a guardian and come back to the same gathering.
 */
export const holder: {
  descriptor?: DeploymentDescriptor; provider?: IProvider; readClient?: PublicClient; account?: HolderAccount; kit?: Kit;
  gathering?: Gathering; ripe: boolean;
} = { ripe: false };

onReset((chainChanged) => {
  holder.ripe = false;
  button('execute').disabled = true;

  if (!chainChanged) return;

  Object.assign(holder, { descriptor: undefined, provider: undefined, readClient: undefined, account: undefined, kit: undefined, gathering: undefined });
  accountLine.textContent = 'The chain changed: apply the deployment again.';
});

/** The kit over the wallet provider, with the connected key as the one candidate key unless a configuration is given. */
export function buildKit(
  provider: IProvider,
  descriptor: DeploymentDescriptor,
  account: HolderAccount,
  key: Address,
  configuration = clientConfiguration(key, tokenAllowlist(), account.creation),
): Kit {
  return assembleKit(assembleParts(provider, descriptor, account.address, BLOCK_TAGS, WEB_LOG_CHUNK_SIZE), configuration);
}

/** Caches the chosen account and its kit, naming the connected key as the one candidate key. */
export function useAccount(conn: Connection, account: HolderAccount): Kit {
  ensureSession(conn.session);

  const { descriptor, provider } = holder;

  if (descriptor === undefined || provider === undefined) throw new Error('apply the deployment first');

  const kit = buildKit(provider, descriptor, account, conn.account);

  step('clients');
  note('account', account.address);
  note('candidate key (the connected account)', conn.account);
  Object.assign(holder, { account, kit, gathering: undefined, ripe: false });
  accountLine.textContent = `Account ${account.address}${account.sendsSelfCalls ? '' : ' (EOA stand-in: reads and prepares only)'}.`;

  return requireKit().kit;
}

/** The cached kit, rebuilt over the same account and candidate key when the order's token is not in its allowlist. */
export function kitForOrder(token: Address): Kit {
  const { kit, account } = requireKit();
  const [key] = kit.configuration.candidateKeys;

  if (key === undefined || holder.provider === undefined || kit.configuration.tokens.some((listed) => isAddressEqual(listed, token))) return kit;

  const rebuilt = buildKit(holder.provider, kit.descriptor, account, key);

  note('token allowlist', rebuilt.configuration.tokens);
  holder.kit = rebuilt;

  return requireKit().kit;
}

/** Traces, before a flow runs, that the EOA stand-in sends nothing. */
export function noteStandIn(): void {
  if (holder.account?.sendsSelfCalls === false) {
    note('EOA stand-in: reads and prepares only, nothing is sent; Create or Select an Ambire account to commit');
  }
}

/**
 * The chosen account with its kit and provider rebuilt over the running action's lifetime, so a request an ended
 * action left behind can never reach, or be timed into, a later one. Throws until an account is chosen.
 */
export function requireKit(): { kit: Kit; provider: IProvider; account: HolderAccount } {
  const { kit, provider, account } = holder;

  if (kit === undefined || provider === undefined || account === undefined) throw new Error('apply the deployment and choose an account first');

  const bound = bindProvider(provider, currentLifetime());
  const [key] = kit.configuration.candidateKeys;

  return { kit: buildKit(bound, kit.descriptor, account, key ?? account.address, kit.configuration), provider: bound, account };
}

/** Reads `setupState()` and `recoveryState()` and prints both, bigints as decimal strings. */
export async function refreshState(conn: Connection): Promise<void> {
  const { kit } = requireKit();

  step('setupState / recoveryState');

  const setupState = await kit.setup.setupState();

  ensureSession(conn.session);

  const recoveryState = await kit.recovery.recoveryState();

  ensureSession(conn.session);
  note('setupState', setupState);
  note('recoveryState', recoveryState);
  stateOut.textContent = `read as ${conn.account}\nsetupState ${show(setupState)}\nrecoveryState ${show(recoveryState)}`;
}
