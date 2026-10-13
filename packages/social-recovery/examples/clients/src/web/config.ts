import {
  type ClientConfiguration,
  type CreationRecord,
  type DeploymentDescriptor,
  DIGEST_VERSION,
  type IProvider,
  PolicyManager,
} from '@kohaku-eth/social-recovery';
import { type Address, getAddress, isAddress, zeroAddress } from 'viem';
import { note, step } from '../trace';
import { field, valueOf } from './page';
import { SEPOLIA_CHAIN_ID } from './wallet';

/** The factory's deploy function when `VITE_AMBIRE_FACTORY_DEPLOY_FUNCTION` names none. */
export const DEFAULT_DEPLOY_FUNCTION = 'function deploy(bytes code, uint256 salt) returns (address)';

/** Reads and watches at `latest`, as the Node scripts do. */
export const BLOCK_TAGS = { read: 'latest', watch: 'latest' } as const;

/** The deployment form's values, typed. */
export type DeploymentInputs = {
  readonly manager: Address;
  readonly methodEcdsa: Address;
  readonly methodPasskey: Address;
  readonly methodAadhaar: Address;
  readonly methodZkpassport: Address;
  readonly action: Address;
  readonly servedImplementation: Address;
  readonly deployedAt: number;
  readonly managerVersion?: string;
  readonly account?: Address;
};

/** Fills each deployment field from its `VITE_` variable of the package's `.env`; a field already typed is kept. */
export function prefillDeployment(): void {
  const env = import.meta.env;
  const prefill: Record<string, string | undefined> = {
    'manager': env.VITE_MANAGER_ADDRESS,
    'method-ecdsa': env.VITE_METHOD_ECDSA_ADDRESS,
    'method-passkey': env.VITE_METHOD_PASSKEY_ADDRESS,
    'method-aadhaar': env.VITE_METHOD_AADHAAR_ADDRESS,
    'method-zkpassport': env.VITE_METHOD_ZKPASSPORT_ADDRESS,
    'action': env.VITE_ACTION_ADDRESS,
    'implementation': env.VITE_AMBIRE_IMPLEMENTATION_ADDRESS,
    'deploy-block': env.VITE_DEPLOY_BLOCK,
    'factory': env.VITE_AMBIRE_FACTORY,
    'factory-deploy': env.VITE_AMBIRE_FACTORY_DEPLOY_FUNCTION || DEFAULT_DEPLOY_FUNCTION,
    'manager-version': env.VITE_MANAGER_VERSION,
    'account-address': env.VITE_ACCOUNT_ADDRESS,
  };

  for (const [name, value] of Object.entries(prefill)) {
    if (value !== undefined && valueOf(name) === '') field(name).value = value.trim();
  }
}

/** One form field as an address; blank takes `fallback` where there is one. */
export function addressField(name: string, fallback?: Address): Address {
  const value = valueOf(name);

  if (value === '' && fallback !== undefined) return fallback;

  if (!isAddress(value, { strict: false })) throw new Error(`the field ${name} must be an address`);

  return getAddress(value);
}

/** One form field as a whole number. */
export function wholeField(name: string): number {
  const value = valueOf(name);

  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`the field ${name} must be a whole number`);

  return Number(value);
}

/** The deployment form read and typed; a malformed field throws naming it. */
export function deploymentInputs(): DeploymentInputs {
  const managerVersion = valueOf('manager-version');
  const account = valueOf('account-address');

  return {
    manager: addressField('manager'),
    methodEcdsa: addressField('method-ecdsa'),
    methodPasskey: addressField('method-passkey'),
    methodAadhaar: addressField('method-aadhaar', zeroAddress),
    methodZkpassport: addressField('method-zkpassport', zeroAddress),
    action: addressField('action'),
    servedImplementation: addressField('implementation'),
    deployedAt: wholeField('deploy-block'),
    ...(managerVersion === '' ? {} : { managerVersion }),
    ...(account === '' ? {} : { account: addressField('account-address') }),
  };
}

/**
 * The descriptor from the form, checked against the chain as the Node scripts check theirs: the wallet's chain id must
 * be Sepolia's, and the deployed manager's `version()` and EIP-712 domain must match what the descriptor states.
 */
export async function deploymentDescriptor(inputs: DeploymentInputs, provider: IProvider): Promise<DeploymentDescriptor> {
  step('deployment descriptor');

  const chainId = await provider.chainId();

  if (chainId !== SEPOLIA_CHAIN_ID) throw new Error(`the wallet answers chain id ${chainId}, the descriptor names ${SEPOLIA_CHAIN_ID}`);

  const descriptor: DeploymentDescriptor = {
    chainId: SEPOLIA_CHAIN_ID,
    manager: inputs.manager,
    methodEcdsa: inputs.methodEcdsa,
    methodPasskey: inputs.methodPasskey,
    methodAadhaar: inputs.methodAadhaar,
    methodZkpassport: inputs.methodZkpassport,
    action: inputs.action,
    servedImplementation: inputs.servedImplementation,
    deployedAt: inputs.deployedAt,
    digestVersion: DIGEST_VERSION,
    managerVersion: inputs.managerVersion ?? '',
    shippedMethods: [inputs.methodEcdsa, inputs.methodPasskey],
    auditedActions: [inputs.action],
  };
  const probe = new PolicyManager(provider, descriptor, inputs.action, inputs.action, BLOCK_TAGS);
  const managerVersion = await probe.version();
  const domain = await probe.eip712Domain();

  note('manager version()', managerVersion);
  note('manager eip712Domain().version', domain.version);

  if (inputs.managerVersion !== undefined && inputs.managerVersion !== managerVersion) {
    throw new Error(`the manager answers version ${managerVersion}, the form names ${inputs.managerVersion}`);
  }

  if (domain.version !== DIGEST_VERSION) throw new Error(`the manager signs digest version ${domain.version}, this SDK builds ${DIGEST_VERSION}`);

  if (domain.chainId !== SEPOLIA_CHAIN_ID) throw new Error(`the manager's domain names chain id ${domain.chainId}`);

  return { ...descriptor, managerVersion };
}

/** The token allowlist: the native asset, and the attempt form's order token beside it when one is set. */
export function tokenAllowlist(): readonly Address[] {
  const token = valueOf('order-token');

  if (!isAddress(token, { strict: false }) || getAddress(token) === zeroAddress) return [zeroAddress];

  return [zeroAddress, getAddress(token)];
}

/**
 * The page's client configuration, the Node scripts' values: two-day default and short waits, a thirty-day maximum,
 * a one-day request window (one-hour floor), a twelve-hour cancel window and the rule cost bound; the holder as the
 * one candidate key and `tokens` as the token allowlist.
 */
export function clientConfiguration(holder: Address, tokens: readonly Address[], creation?: CreationRecord): ClientConfiguration {
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
    tokens,
    simulate: true,
  };
}
