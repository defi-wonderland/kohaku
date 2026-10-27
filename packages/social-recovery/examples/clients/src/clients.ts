import {
  AmbireActionCodec,
  type ClientConfiguration,
  type CreationRecord,
  type DeploymentDescriptor,
  DIGEST_VERSION,
  EventManager,
  type IMethodModuleReads,
  type IMethodsOrchestrator,
  type IProvider,
  type IRecoveryActionInteractor,
  type IRecoveryClient,
  type ISetupClient,
  type ManagerReading,
  passkeyMethod,
  PolicyManager,
  SocialRecoveryBuilder,
  walletMethod,
} from '@kohaku-eth/social-recovery';
import { type Address, isAddressEqual, zeroAddress } from 'viem';
import type { Env } from './env';
import { signerRecovery } from './signer-recovery';
import { note, step } from './trace';

/** Sepolia, the only chain the sample runs against. */
export const SEPOLIA_CHAIN_ID = 11155111;

/**
 * The builder's kit for one account, beside the reads the sample's own checks make: the action state at a pinned block,
 * the account's notifications and the handover payload's decoding. Those three are the sample's, not the clients'.
 */
export type Kit = {
  readonly descriptor: DeploymentDescriptor;
  readonly configuration: ClientConfiguration;
  readonly reading: ManagerReading;
  readonly setup: ISetupClient;
  readonly recovery: IRecoveryClient;
  readonly orchestrator: IMethodsOrchestrator;
  readonly recoveryAction: IRecoveryActionInteractor;
  readonly moduleReads: IMethodModuleReads;
  /** The modules the builder's shipped wallet and passkey methods serve under the descriptor. */
  readonly implementedMethods: readonly Address[];
  readonly policyManager: PolicyManager;
  readonly events: EventManager;
  readonly codec: AmbireActionCodec;
};

const BLOCK_TAGS = { read: 'latest', watch: 'latest' } as const;

/**
 * The sample's client configuration: two-day default and short waits, a thirty-day maximum, a one-day request window
 * (one-hour floor), a twelve-hour cancel window and the rule cost bound; the order's token as the allowlist and the
 * holder's key as the one candidate.
 */
function clientConfiguration(env: Env, holder: Address, creation?: CreationRecord): ClientConfiguration {
  return {
    defaultWait: 172800,
    shortWait: 172800,
    maxWait: 2592000,
    requestWindow: { default: 86400, floor: 3600 },
    cancelWindow: 43200,
    ruleCostBound: 10000000,
    ...(creation === undefined ? {} : { creation }),
    candidateKeys: [holder],
    blockTags: BLOCK_TAGS,
    logChunkSize: 10000,
    tokens: [env.orderToken],
    simulate: true,
  };
}

/**
 * The descriptor from the environment, checked against the chain: the RPC's chain id must be Sepolia's, and the
 * deployed manager's `version()` and EIP-712 domain version must match what the descriptor states.
 */
export async function deploymentDescriptor(env: Env, provider: IProvider): Promise<DeploymentDescriptor> {
  step('deployment descriptor');

  const chainId = await provider.chainId();

  if (chainId !== SEPOLIA_CHAIN_ID) throw new Error(`the RPC answers chain id ${chainId}, the descriptor names ${SEPOLIA_CHAIN_ID}`);

  const descriptor: DeploymentDescriptor = {
    chainId: SEPOLIA_CHAIN_ID,
    manager: env.manager,
    methodEcdsa: env.methodEcdsa,
    methodPasskey: env.methodPasskey,
    methodAadhaar: env.methodAadhaar,
    methodZkpassport: env.methodZkpassport,
    action: env.action,
    servedImplementation: env.servedImplementation,
    deployedAt: env.deployedAt,
    digestVersion: DIGEST_VERSION,
    managerVersion: env.managerVersion ?? '',
    shippedMethods: [env.methodEcdsa, env.methodPasskey],
    auditedActions: [env.action],
  };
  const probe = new PolicyManager(provider, descriptor, env.action, env.action, BLOCK_TAGS);
  const managerVersion = await probe.version();
  const domain = await probe.eip712Domain();

  note('manager version()', managerVersion);
  note('manager eip712Domain().version', domain.version);

  if (env.managerVersion !== undefined && env.managerVersion !== managerVersion) {
    throw new Error(`the manager answers version ${managerVersion}, MANAGER_VERSION names ${env.managerVersion}`);
  }

  if (domain.version !== DIGEST_VERSION) throw new Error(`the manager signs digest version ${domain.version}, this SDK builds ${DIGEST_VERSION}`);

  if (domain.chainId !== SEPOLIA_CHAIN_ID) throw new Error(`the manager's domain names chain id ${domain.chainId}`);

  return { ...descriptor, managerVersion };
}

/** Which of the two holder keys the account holds now; the other is the one a handover gives it. */
export type HolderKeys = { readonly current: Address; readonly next: Address };

/** The modules the builder's shipped methods claim under the descriptor, the zero address left out. */
const shippedModules = (descriptor: DeploymentDescriptor): Address[] =>
  [walletMethod(), passkeyMethod()]
    .flatMap((method) => [...method.modules(descriptor)])
    .filter((module) => !isAddressEqual(module, zeroAddress));

/**
 * The holder's kit through `SocialRecoveryBuilder`: the builder runs its construction checks (the chain id, the manager's
 * EIP-712 domain and `version()`) unless `reading` hands it an earlier build's reading of the same manager, which leaves
 * only the chain id to read. The signer recovery is handed over so both clients name the removed key as before.
 */
export async function kitOver(
  provider: IProvider,
  descriptor: DeploymentDescriptor,
  account: Address,
  configuration: ClientConfiguration,
  reading?: ManagerReading,
): Promise<Kit> {
  const builder = SocialRecoveryBuilder.from({ provider, account, descriptor, configuration }).withSignerRecovery(signerRecovery);

  if (reading !== undefined) builder.withManagerReading(reading);

  const built = await builder.build();
  const recoveryAction = await builder.recoveryAction();
  const moduleReads = await builder.methodModuleReads();
  const { action } = descriptor;

  return {
    descriptor,
    configuration,
    reading: builder.managerReading() as ManagerReading,
    setup: built.setupClient,
    recovery: built.recoveryClient,
    orchestrator: built.methodsOrchestrator,
    recoveryAction,
    moduleReads,
    implementedMethods: shippedModules(descriptor),
    policyManager: new PolicyManager(provider, descriptor, account, action, configuration.blockTags),
    events: new EventManager(provider, descriptor, account, action, new Map(), configuration),
    codec: new AmbireActionCodec([action]),
  };
}

/**
 * Builds the kit with the first holder key as the candidate, names the current holder key from the action's
 * `isAuthority`, and builds again over the same reading where the keys swapped. `holders` lists them in env order.
 */
export async function buildKit(
  provider: IProvider,
  descriptor: DeploymentDescriptor,
  env: Env,
  account: Address,
  holders: HolderKeys,
  creation?: CreationRecord,
): Promise<{ kit: Kit; holders: HolderKeys }> {
  const first = await kitOver(provider, descriptor, account, clientConfiguration(env, holders.current, creation));
  const swapped = env.accountMode !== 'eoa' && !(await first.recoveryAction.isAuthority(holders.current))
    && (await first.recoveryAction.isAuthority(holders.next));
  const named = swapped ? { current: holders.next, next: holders.current } : holders;
  const kit = swapped ? await kitOver(provider, descriptor, account, clientConfiguration(env, named.current, creation), first.reading) : first;

  step('clients (SocialRecoveryBuilder)');
  note('account', account);
  note('holder key now', named.current);
  note('handover target key', named.next);

  return { kit, holders: named };
}
