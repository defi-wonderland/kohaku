import { type CreationRecord, creationPrivileges, type IProvider } from '@kohaku-eth/social-recovery';
import { type Abi, type Address, encodeFunctionData, hexToBigInt, parseAbiItem, type PublicClient, type WalletClient } from 'viem';
import type { Env } from './env';
import { note, step } from './trace';

/** The holder's account as one mode provides it. */
export type HolderAccount = {
  readonly address: Address;
  /** False for the EOA stand-in, whose flows stop before any account self-call. */
  readonly sendsSelfCalls: boolean;
  readonly creation?: CreationRecord;
};

/** Mode `existing`: the Ambire account the environment names, which must hold code. */
async function existingAccount(env: Env, provider: IProvider): Promise<HolderAccount> {
  const address = env.account as Address;

  if ((await provider.code(address, 'latest')) === '0x') throw new Error(`ACCOUNT_ADDRESS ${address} holds no code`);

  return { address, sendsSelfCalls: true };
}

/**
 * Mode `create`: the account the factory's `CREATE2` of the env creation code gives, deployed by the sponsor
 * through the env deploy function when it holds no code yet. Untested until the integrator supplies Ambire's inputs.
 */
async function createdAccount(env: Env, provider: IProvider, client: PublicClient, sponsor: WalletClient): Promise<HolderAccount> {
  const inputs = env.creation;

  if (inputs === undefined) throw new Error('mode create needs the AMBIRE_* creation inputs');

  const { account, entries } = creationPrivileges(inputs.factory, inputs.creationCode, inputs.salt);

  note('predicted account', account);
  note('privilege entries the creation code writes', entries);

  if ((await provider.code(account, 'latest')) !== '0x') {
    note('the account already exists');

    const creation = inputs.createdAt === undefined
      ? undefined
      : { factory: inputs.factory, bytecode: inputs.creationCode, salt: inputs.salt, block: inputs.createdAt };

    return { address: account, sendsSelfCalls: true, ...(creation === undefined ? {} : { creation }) };
  }

  const data = encodeFunctionData({
    abi: [parseAbiItem(inputs.deployFunction)] as Abi,
    args: [inputs.creationCode, hexToBigInt(inputs.salt)],
  });
  const hash = await sponsor.sendTransaction({ to: inputs.factory, data, account: sponsor.account ?? null, chain: sponsor.chain ?? null });

  note('factory deploy tx', hash);

  const receipt = await client.waitForTransactionReceipt({ hash });

  if (receipt.status !== 'success') throw new Error(`the factory deploy ${hash} reverted`);

  if ((await provider.code(account, 'latest')) === '0x') throw new Error(`the factory deploy left no code at ${account}`);

  return {
    address: account,
    sendsSelfCalls: true,
    creation: { factory: inputs.factory, bytecode: inputs.creationCode, salt: inputs.salt, block: Number(receipt.blockNumber) },
  };
}

/** The holder's account in the mode `ACCOUNT_MODE` selects; mode `eoa` stands the holder's own address in. */
export async function holderAccount(
  env: Env,
  provider: IProvider,
  client: PublicClient,
  sponsor: WalletClient,
  holder: Address,
): Promise<HolderAccount> {
  step(`account (mode ${env.accountMode})`);

  if (env.accountMode === 'existing') return existingAccount(env, provider);

  if (env.accountMode === 'create') return createdAccount(env, provider, client, sponsor);

  note('EOA stand-in: reads and prepares only, no account self-call is sent');

  return { address: holder, sendsSelfCalls: false };
}
