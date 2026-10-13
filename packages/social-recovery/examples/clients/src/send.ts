import type { PreparedBatch, PreparedCall } from '@kohaku-eth/social-recovery';
import { type Account, encodeFunctionData, type Hex, parseAbi, type TransactionReceipt, type WalletClient } from 'viem';
import type { Session } from './session';
import { note, show } from './trace';

/** Ambire's batch entry for a caller holding a privilege, the call the holder sends to its own account. */
const ACCOUNT_ABI = parseAbi(['function executeBySender((address to, uint256 value, bytes data)[] calls) payable']);

type Signer = WalletClient & { readonly account: Account };

/** Refuses a prepared call whose simulation failed, naming the decoded error. */
function assertSimulated(call: PreparedCall): void {
  const { simulation } = call;

  if (simulation === undefined) {
    note('simulation skipped');

    return;
  }

  if (!simulation.success) {
    throw new Error(`the prepared call to ${call.target} fails in simulation from ${simulation.from}: ${show(simulation.error)}`);
  }
}

async function sendAndWait(session: Session, signer: Signer, to: `0x${string}`, data: Hex, value: bigint): Promise<TransactionReceipt> {
  const hash = await signer.sendTransaction({ to, data, value, account: signer.account, chain: signer.chain ?? null });

  note('tx sent', hash);

  const receipt = await session.client.waitForTransactionReceipt({ hash });

  note('tx mined', `block ${receipt.blockNumber}, status ${receipt.status}, gas ${receipt.gasUsed}`);

  if (receipt.status !== 'success') throw new Error(`transaction ${hash} reverted`);

  return receipt;
}

/** Sends a call anyone may send, from the sponsor. */
export async function sendFromSponsor(session: Session, call: PreparedCall): Promise<TransactionReceipt> {
  if (call.sender !== 'anyone') throw new Error(`the prepared call is the ${call.sender}'s to send`);

  assertSimulated(call);
  note('sponsor sends', `${session.sponsor.account.address} → ${call.target}`);

  return sendAndWait(session, session.sponsor, call.target, call.data, call.value);
}

/**
 * Sends the account's own call or batch as one `executeBySender` from the key the account holds, so a batch lands
 * atomically. The EOA stand-in refuses: its flows stop before any account self-call.
 */
export async function sendAsAccount(session: Session, prepared: PreparedCall | PreparedBatch): Promise<TransactionReceipt> {
  const calls = prepared.kind === 'batch' ? prepared.calls : [prepared];

  if (!session.account.sendsSelfCalls) throw new Error('the EOA stand-in sends no account self-call');

  if (calls.some((call) => call.sender !== 'account')) throw new Error('a call in the batch is not the account\'s to send');

  calls.forEach(assertSimulated);

  const data = encodeFunctionData({
    abi: ACCOUNT_ABI,
    functionName: 'executeBySender',
    args: [calls.map((call) => ({ to: call.target, value: call.value, data: call.data }))],
  });

  note('holder sends executeBySender', `${session.holder.account.address} → ${session.account.address} (${calls.length} call(s))`);

  return sendAndWait(session, session.holder, session.account.address, data, 0n);
}
