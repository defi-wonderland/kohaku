import type { IProvider } from '@kohaku-eth/social-recovery';
import type { HolderAccount } from '../account';
import { check, note, step } from '../trace';
import { addressField, DEFAULT_DEPLOY_FUNCTION, deploymentDescriptor, deploymentInputs } from './config';
import { checkedCreation, deployCalldata, randomSalt } from './creation';
import { holder, useAccount } from './kit';
import { field, valueOf } from './page';
import { WalletProvider } from './provider';
import { readRpcProvider, readRpcUrl } from './reads';
import { sendTransaction } from './send';
import { type Connection, ensureSession, SEPOLIA_CHAIN_ID, wallet } from './wallet';

/** Fills the salt field with a fresh random salt. */
export function newSalt(): void {
  field('salt').value = randomSalt();
}

/** Checks the descriptor against the chain through the Read RPC URL when set, else the wallet, then takes the form's account, or the EOA stand-in. */
export async function applyDeployment(conn: Connection): Promise<void> {
  const inputs = deploymentInputs();
  const text = valueOf('read-rpc');
  const reads = text === '' ? undefined : readRpcProvider(readRpcUrl(text), () => wallet.session);
  const provider = reads?.provider ?? new WalletProvider(conn.wallet, () => wallet.session);

  if (reads !== undefined) {
    const chainId = await provider.chainId();

    ensureSession(conn.session);

    if (chainId !== SEPOLIA_CHAIN_ID) throw new Error(`the Read RPC URL answers chain id ${chainId}, not Sepolia (${SEPOLIA_CHAIN_ID})`);

    note('reads through the Read RPC URL', readRpcUrl(text).host);
  }

  const descriptor = await deploymentDescriptor(inputs, provider, conn.session);

  ensureSession(conn.session);
  Object.assign(holder, { descriptor, provider, readClient: reads?.client, account: undefined, kit: undefined, gathering: undefined, ripe: false });

  if (inputs.account === undefined) {
    standIn(conn);

    return;
  }

  await selectAccount(conn);
  ensureSession(conn.session);
}

function requireDeployment(): { descriptor: NonNullable<typeof holder.descriptor>; provider: IProvider } {
  const { descriptor, provider } = holder;

  if (descriptor === undefined || provider === undefined) throw new Error('apply the deployment first');

  return { descriptor, provider };
}

/** The form's existing account: it must hold code; whether the connected account is its authority is shown. */
export async function selectAccount(conn: Connection): Promise<void> {
  const { provider } = requireDeployment();
  const address = addressField('account-address');

  step('select the existing account');

  const code = await provider.code(address, 'latest');

  ensureSession(conn.session);

  if (code === '0x') throw new Error(`the account ${address} holds no code`);

  const account: HolderAccount = { address, sendsSelfCalls: true };
  const kit = useAccount(conn, account);
  const authority = await kit.recoveryAction.isAuthority(conn.account);

  ensureSession(conn.session);
  note(`isAuthority(${conn.account})`, authority);

  if (!authority) note('the connected account is not an authority: the account\'s own calls are refused until one connects');
}

/** The connected address stands in for the account: reads and prepares only, no account self-call is sent. */
export function standIn(conn: Connection): void {
  step('EOA stand-in');
  note('reads and prepares only; no account self-call is sent');
  useAccount(conn, { address: conn.account, sendsSelfCalls: false });
}

/**
 * Builds and checks the creation code for the connected address, shows the predicted account and deploys it through the
 * factory when that address holds no code; the creation record goes into the client configuration.
 */
export async function createAccount(conn: Connection): Promise<void> {
  const { descriptor, provider } = requireDeployment();
  const factory = addressField('factory');
  const deployFunction = valueOf('factory-deploy') === '' ? DEFAULT_DEPLOY_FUNCTION : valueOf('factory-deploy');

  if (valueOf('salt') === '') newSalt();

  const salt = valueOf('salt') as `0x${string}`;

  step('create an Ambire account');

  const { code, account, slot } = checkedCreation(factory, conn.account, descriptor.servedImplementation, salt);

  note('signer (the connected account)', conn.account);
  note('privilege slot', slot);
  note('creation code', code);
  note('salt', salt);
  note('predicted account (CREATE2)', account);

  const existing = await provider.code(account, 'latest');

  ensureSession(conn.session);

  if (existing !== '0x') {
    note('the account already exists; its creation block is unknown here, so no creation record is kept');
    useAccount(conn, { address: account, sendsSelfCalls: true });

    return;
  }

  const receipt = await sendTransaction(conn, factory, deployCalldata(deployFunction, code, salt), 0n);

  ensureSession(conn.session);

  const deployed = await provider.code(account, receipt.blockNumber);

  ensureSession(conn.session);
  check(deployed !== '0x', `the factory deployed code at ${account}`);

  const creation = { factory, bytecode: code, salt, block: receipt.blockNumber };

  note('creation record', creation);
  useAccount(conn, { address: account, sendsSelfCalls: true, creation });
}
