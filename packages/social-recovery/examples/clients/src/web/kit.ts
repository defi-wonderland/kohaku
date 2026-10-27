import type { ClientConfiguration, DeploymentDescriptor, Gathering, IProvider, ManagerReading } from '@kohaku-eth/social-recovery';
import { type Address, isAddressEqual, type PublicClient } from 'viem';
import type { HolderAccount } from '../account';
import { type Kit, kitOver } from '../clients';
import { note, show, step } from '../trace';
import { clientConfiguration, tokenAllowlist } from './config';
import { accountLine, button, stateOut } from './page';
import { currentLifetime, type Lifetime } from './lifetime';
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

type BoundKit = { kit: Kit; provider: IProvider; account: HolderAccount };

/** The kit each action built, per action and per cached kit, so one action builds once however often it asks. */
const perAction = new WeakMap<Lifetime, { source: Kit; built: Promise<BoundKit> }>();

/**
 * Builds the kit through the builder over the cached provider bound to the running action, `reading` sparing the
 * manager reads an earlier build took, and keeps it for the rest of that action under the cached kit it stands for
 * (`source`, else the new kit itself).
 */
function buildFor(account: HolderAccount, configuration: ClientConfiguration, reading?: ManagerReading, source?: Kit): Promise<BoundKit> {
  const { descriptor, provider } = holder;

  if (descriptor === undefined || provider === undefined) throw new Error('apply the deployment first');

  const life = currentLifetime();
  const bound = bindProvider(provider, life);

  return kitOver(bound, descriptor, account.address, configuration, reading).then((kit) => {
    perAction.set(life, { source: source ?? kit, built: Promise.resolve({ kit, provider: bound, account }) });

    return { kit, provider: bound, account };
  });
}

/** Builds and caches the chosen account's kit, naming the connected key as the one candidate key. */
export async function useAccount(conn: Connection, account: HolderAccount): Promise<Kit> {
  ensureSession(conn.session);
  step('clients (SocialRecoveryBuilder)');

  const { kit } = await buildFor(account, clientConfiguration(conn.account, tokenAllowlist(), account.creation));

  ensureSession(conn.session);
  note('account', account.address);
  note('candidate key (the connected account)', conn.account);
  note('manager reading', kit.reading);
  Object.assign(holder, { account, kit, gathering: undefined, ripe: false });
  accountLine.textContent = `Account ${account.address}${account.sendsSelfCalls ? '' : ' (EOA stand-in: reads and prepares only)'}.`;

  return kit;
}

/** The kit for the running action, rebuilt with the order's token in its allowlist when it is not there yet. */
export async function kitForOrder(token: Address): Promise<Kit> {
  const { kit, account } = holder;

  if (kit === undefined || account === undefined) throw new Error('apply the deployment and choose an account first');

  const [key] = kit.configuration.candidateKeys;

  if (key === undefined || kit.configuration.tokens.some((listed) => isAddressEqual(listed, token))) return (await requireKit()).kit;

  const rebuilt = (await buildFor(account, clientConfiguration(key, tokenAllowlist(), account.creation), kit.reading)).kit;

  note('token allowlist', rebuilt.configuration.tokens);
  holder.kit = rebuilt;

  return rebuilt;
}

/** Traces, before a flow runs, that the EOA stand-in sends nothing. */
export function noteStandIn(): void {
  if (holder.account?.sendsSelfCalls === false) {
    note('EOA stand-in: reads and prepares only, nothing is sent; Create or Select an Ambire account to commit');
  }
}

/**
 * The chosen account with its kit and provider rebuilt over the running action's lifetime, so a request an ended
 * action left behind can never reach, or be timed into, a later one; the rebuild reuses the cached manager reading
 * and runs once per action. Throws until an account is chosen.
 */
export async function requireKit(): Promise<BoundKit> {
  const { kit, account } = holder;

  if (kit === undefined || account === undefined) throw new Error('apply the deployment and choose an account first');

  const cached = perAction.get(currentLifetime());

  if (cached !== undefined && cached.source === kit) return cached.built;

  return buildFor(account, kit.configuration, kit.reading, kit);
}

/** Reads `setupState()` and `recoveryState()` and prints both, bigints as decimal strings. */
export async function refreshState(conn: Connection): Promise<void> {
  const { kit } = await requireKit();

  step('setupState / recoveryState');

  const setupState = await kit.setup.setupState();

  ensureSession(conn.session);

  const recoveryState = await kit.recovery.recoveryState();

  ensureSession(conn.session);
  note('setupState', setupState);
  note('recoveryState', recoveryState);
  stateOut.textContent = `read as ${conn.account}\nsetupState ${show(setupState)}\nrecoveryState ${show(recoveryState)}`;
}
