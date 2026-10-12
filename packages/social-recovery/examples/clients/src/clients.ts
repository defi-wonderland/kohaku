import {
  AmbireActionCodec,
  AmbireRecoveryAction,
  type ClientConfiguration,
  type CreationRecord,
  type DeploymentDescriptor,
  DIGEST_VERSION,
  EventManager,
  type IProvider,
  type IRecoveryClient,
  type IRecoveryMethod,
  type ISetupClient,
  type MethodRegistry,
  PolicyManager,
  RecoveryClient,
  SetupClient,
  walletMethod,
} from '@kohaku-eth/social-recovery';
import type { Address } from 'viem';
import { type Env, SEPOLIA_CHAIN_ID } from './env';
import { signerRecovery } from './signer-recovery';
import { note, step } from './trace';

/** Both clients and the parts they share, bound to one account and the deployment's action. */
export type Kit = {
  readonly descriptor: DeploymentDescriptor;
  readonly configuration: ClientConfiguration;
  readonly policyManager: PolicyManager;
  readonly recoveryAction: AmbireRecoveryAction;
  readonly codec: AmbireActionCodec;
  readonly events: EventManager;
  readonly method: IRecoveryMethod;
  readonly setup: ISetupClient;
  readonly recovery: IRecoveryClient;
};

const BLOCK_TAGS = { read: 'latest', watch: 'latest' } as const;

/** D-208's numbers, the order's token as the allowlist and the holder's key as the one candidate. */
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

/**
 * Builds the parts in the merged constructors' order, names the current holder key from the action's `isAuthority`,
 * then builds both clients over the same parts. `holders` lists the two holder addresses in env order.
 */
export async function buildKit(
  provider: IProvider,
  descriptor: DeploymentDescriptor,
  env: Env,
  account: Address,
  holders: HolderKeys,
  creation?: CreationRecord,
): Promise<{ kit: Kit; holders: HolderKeys }> {
  const { action } = descriptor;
  const codec = new AmbireActionCodec([action]);
  const policyManager = new PolicyManager(provider, descriptor, account, action, BLOCK_TAGS);
  const recoveryAction = new AmbireRecoveryAction(provider, descriptor, account, action, codec, BLOCK_TAGS);
  const method = walletMethod();
  const methods: MethodRegistry = new Map([[descriptor.methodEcdsa, method]]);
  const events = new EventManager(provider, descriptor, account, action, methods, { logChunkSize: 10000 });
  const swapped = env.accountMode !== 'eoa' && !(await recoveryAction.isAuthority(holders.current)) && (await recoveryAction.isAuthority(holders.next));
  const named = swapped ? { current: holders.next, next: holders.current } : holders;
  const configuration = clientConfiguration(env, named.current, creation);

  step('clients');
  note('account', account);
  note('holder key now', named.current);
  note('handover target key', named.next);

  const setup = new SetupClient(
    provider, descriptor, account, action, configuration, 'integrator',
    policyManager, recoveryAction, events, methods, codec, signerRecovery,
  );
  // Type-checks once PT-074 lands the ten members and `implements IRecoveryClient` on `RecoveryClient`.
  const recovery: IRecoveryClient = new RecoveryClient(
    provider, descriptor, account, action, configuration,
    policyManager, recoveryAction, events, methods, codec, signerRecovery,
  );

  return { kit: { descriptor, configuration, policyManager, recoveryAction, codec, events, method, setup, recovery }, holders: named };
}
