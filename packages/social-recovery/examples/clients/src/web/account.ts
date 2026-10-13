import type { HolderAccount } from '../account';
import { check, note, step } from '../trace';
import { addressField, DEFAULT_DEPLOY_FUNCTION, deploymentDescriptor, deploymentInputs } from './config';
import { checkedCreation, deployCalldata, randomSalt } from './creation';
import { holder, useAccount } from './kit';
import { field, valueOf } from './page';
import { WalletProvider } from './provider';
import { sendTransaction } from './send';
import { type Connection, settled, wallet } from './wallet';

/** Fills the salt field with a fresh random salt. */
export function newSalt(): void {
  field('salt').value = randomSalt();
}

/** Checks the descriptor against the chain through the wallet, then takes the form's account, or the EOA stand-in. */
export async function applyDeployment(conn: Connection): Promise<void> {
  const inputs = deploymentInputs();
  const provider = new WalletProvider(conn.wallet, () => wallet.session);
  const descriptor = await settled(conn.session, deploymentDescriptor(inputs, provider));

  Object.assign(holder, { descriptor, provider, account: undefined, kit: undefined, gathering: undefined, ripe: false });

  if (inputs.account === undefined) {
    standIn(conn);

    return;
  }

  await selectAccount(conn);
}

function requireDeployment(): { descriptor: NonNullable<typeof holder.descriptor>; provider: WalletProvider } {
  const { descriptor, provider } = holder;

  if (descriptor === undefined || provider === undefined) throw new Error('apply the deployment first');

  return { descriptor, provider };
}

/** The form's existing account: it must hold code; whether the connected account is its authority is shown. */
export async function selectAccount(conn: Connection): Promise<void> {
  const { provider } = requireDeployment();
  const address = addressField('account-address');

  step('select the existing account');

  const code = await settled(conn.session, provider.code(address, 'latest'));

  if (code === '0x') throw new Error(`the account ${address} holds no code`);

  const account: HolderAccount = { address, sendsSelfCalls: true };
  const kit = useAccount(conn, account);
  const authority = await settled(conn.session, kit.recoveryAction.isAuthority(conn.account));

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

  if ((await settled(conn.session, provider.code(account, 'latest'))) !== '0x') {
    note('the account already exists; its creation block is unknown here, so no creation record is kept');
    useAccount(conn, { address: account, sendsSelfCalls: true });

    return;
  }

  const receipt = await sendTransaction(conn, factory, deployCalldata(deployFunction, code, salt), 0n);
  const deployed = await settled(conn.session, provider.code(account, 'latest'));

  check(deployed !== '0x', `the factory deployed code at ${account}`);

  const creation = { factory, bytecode: code, salt, block: receipt.blockNumber };

  note('creation record', creation);
  useAccount(conn, { address: account, sendsSelfCalls: true, creation });
}
