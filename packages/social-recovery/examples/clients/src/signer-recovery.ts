import type { ISignerRecovery, RawTransaction } from '@kohaku-eth/social-recovery';
import { type Address, isAddressEqual } from 'viem';

/**
 * The sample's reading of who signed for the account: the holder sends the account's batch directly
 * (`executeBySender`), so the signer is the sender of a transaction addressed to the account, and nobody can be named otherwise.
 */
export const signerRecovery: ISignerRecovery = {
  async recoverSigner(transaction: RawTransaction, account: Address): Promise<Address | undefined> {
    return transaction.to !== null && isAddressEqual(transaction.to, account) ? transaction.from : undefined;
  },
};
