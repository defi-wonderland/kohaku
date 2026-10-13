import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Address, getAddress, type Hex, isAddress, isHex, zeroAddress } from 'viem';

/** Sepolia, the only chain the sample runs against. */
export const SEPOLIA_CHAIN_ID = 11155111;

/** How the holder's account is provided: an existing Ambire account, one created here, or an EOA stand-in. */
export const ACCOUNT_MODES = ['existing', 'create', 'eoa'] as const;

export type AccountMode = (typeof ACCOUNT_MODES)[number];

/** The integrator inputs for creating an Ambire account through its factory (mode `create`). */
export type CreationInputs = {
  readonly factory: Address;
  readonly creationCode: Hex;
  readonly salt: Hex;
  /** The factory's deploy function as a human-readable ABI item taking `(bytes code, uint256 salt)`. */
  readonly deployFunction: string;
  /** The block the account was created in, where it already exists. */
  readonly createdAt?: number;
};

/** Every value the scripts read from the environment, checked once at start. */
export type Env = {
  readonly rpcUrl: string;
  readonly manager: Address;
  readonly methodEcdsa: Address;
  readonly methodPasskey: Address;
  readonly methodAadhaar: Address;
  readonly methodZkpassport: Address;
  readonly action: Address;
  readonly servedImplementation: Address;
  readonly deployedAt: number;
  /** The release string the descriptor expects; absent to take the deployed manager's own. */
  readonly managerVersion?: string;
  readonly accountMode: AccountMode;
  /** The Ambire account (mode `existing`). */
  readonly account?: Address;
  readonly creation?: CreationInputs;
  readonly holderKey: Hex;
  /** The key a recovery hands the account to; the two holder keys swap roles after each handover. */
  readonly newHolderKey: Hex;
  readonly sponsorKey: Hex;
  readonly guardianKeys: readonly Hex[];
  readonly threshold: number;
  /** The wait the setup commits, in seconds. */
  readonly wait: number;
  readonly backupPassword: string;
  readonly orderToken: Address;
  readonly orderAmount: bigint;
  /** Absent to pay the sponsor. */
  readonly orderPayee?: Address;
};

const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^\d+$/;

/** Loads the package's `.env` where it exists; a variable already set in the shell wins. */
function loadEnvFile(): void {
  const path = fileURLToPath(new URL('../.env', import.meta.url));

  if (existsSync(path)) process.loadEnvFile(path);
}

function raw(name: string): string | undefined {
  const value = process.env[name]?.trim();

  return value === undefined || value === '' ? undefined : value;
}

function required(name: string): string {
  const value = raw(name);

  if (value === undefined) throw new Error(`env ${name} is required (see .env.example)`);

  return value;
}

function address(name: string, fallback?: Address): Address {
  const value = raw(name) ?? fallback;

  if (value === undefined) throw new Error(`env ${name} is required (see .env.example)`);

  if (!isAddress(value, { strict: false })) throw new Error(`env ${name} must be an address`);

  return getAddress(value);
}

function optionalAddress(name: string): Address | undefined {
  return raw(name) === undefined ? undefined : address(name);
}

function key(name: string): Hex {
  const value = required(name);

  if (!PRIVATE_KEY.test(value)) throw new Error(`env ${name} must be a 32-byte 0x-prefixed private key`);

  return value as Hex;
}

function uint(name: string, fallback?: number): number {
  const value = raw(name) ?? (fallback === undefined ? undefined : String(fallback));

  if (value === undefined) throw new Error(`env ${name} is required (see .env.example)`);

  if (!UINT.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`env ${name} must be a whole number`);

  return Number(value);
}

function hex(name: string): Hex {
  const value = required(name);

  if (!isHex(value)) throw new Error(`env ${name} must be 0x-prefixed hex`);

  return value;
}

function accountMode(): AccountMode {
  const value = raw('ACCOUNT_MODE') ?? 'existing';

  if (!(ACCOUNT_MODES as readonly string[]).includes(value)) throw new Error(`env ACCOUNT_MODE must be one of ${ACCOUNT_MODES.join(', ')}`);

  return value as AccountMode;
}

function creationInputs(): CreationInputs {
  const createdAt = raw('AMBIRE_ACCOUNT_CREATED_AT');

  return {
    factory: address('AMBIRE_FACTORY'),
    creationCode: hex('AMBIRE_CREATION_CODE'),
    salt: hex('AMBIRE_SALT'),
    deployFunction: required('AMBIRE_FACTORY_DEPLOY_FUNCTION'),
    ...(createdAt === undefined ? {} : { createdAt: uint('AMBIRE_ACCOUNT_CREATED_AT') }),
  };
}

function guardianKeys(): readonly Hex[] {
  const keys = required('GUARDIAN_PRIVATE_KEYS').split(',').map((entry) => entry.trim());

  if (keys.some((entry) => !PRIVATE_KEY.test(entry))) throw new Error('env GUARDIAN_PRIVATE_KEYS must be comma-separated private keys');

  if (new Set(keys.map((entry) => entry.toLowerCase())).size !== keys.length) {
    throw new Error('env GUARDIAN_PRIVATE_KEYS repeats a key; each guardian needs its own');
  }

  return keys as Hex[];
}

/** Reads and checks every variable, failing fast on the first one missing or malformed. */
export function loadEnv(): Env {
  loadEnvFile();

  const mode = accountMode();
  const guardians = guardianKeys();
  const threshold = uint('GUARDIAN_THRESHOLD', 2);
  const amount = required('ORDER_AMOUNT');
  const managerVersion = raw('MANAGER_VERSION');
  const payee = optionalAddress('ORDER_PAYEE');

  if (threshold < 1 || threshold > guardians.length) throw new Error('env GUARDIAN_THRESHOLD must be between 1 and the number of guardians');

  if (!UINT.test(amount)) throw new Error('env ORDER_AMOUNT must be a whole number in the token\'s base units');

  return {
    rpcUrl: required('SEPOLIA_RPC_URL'),
    manager: address('MANAGER_ADDRESS'),
    methodEcdsa: address('METHOD_ECDSA_ADDRESS'),
    methodPasskey: address('METHOD_PASSKEY_ADDRESS'),
    methodAadhaar: address('METHOD_AADHAAR_ADDRESS', zeroAddress),
    methodZkpassport: address('METHOD_ZKPASSPORT_ADDRESS', zeroAddress),
    action: address('ACTION_ADDRESS'),
    servedImplementation: address('AMBIRE_IMPLEMENTATION_ADDRESS'),
    deployedAt: uint('DEPLOY_BLOCK'),
    ...(managerVersion === undefined ? {} : { managerVersion }),
    accountMode: mode,
    ...(mode === 'existing' ? { account: address('ACCOUNT_ADDRESS') } : {}),
    ...(mode === 'create' ? { creation: creationInputs() } : {}),
    holderKey: key('HOLDER_PRIVATE_KEY'),
    newHolderKey: key('NEW_HOLDER_PRIVATE_KEY'),
    sponsorKey: key('SPONSOR_PRIVATE_KEY'),
    guardianKeys: guardians,
    threshold,
    wait: uint('SETUP_WAIT', 120),
    backupPassword: required('BACKUP_PASSWORD'),
    orderToken: address('ORDER_TOKEN'),
    orderAmount: BigInt(amount),
    ...(payee === undefined ? {} : { orderPayee: payee }),
  };
}
