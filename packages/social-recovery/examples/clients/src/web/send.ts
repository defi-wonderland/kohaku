import type { Address, Hex, PreparedBatch, PreparedCall } from '@kohaku-eth/social-recovery';
import { hexToBigInt, hexToNumber, toHex } from 'viem';
import { assertSimulated, executeBySenderData } from '../send';
import { note } from '../trace';
import { requireKit } from './kit';
import { type Connection, ensureSession, wallet } from './wallet';

/** How often the page asks the wallet for a pending transaction's receipt. */
export const RECEIPT_POLL_MS = 4000;

/** The fields of an `eth_getTransactionReceipt` answer the page reads. */
export type MinedReceipt = { readonly hash: Hex; readonly blockNumber: number; readonly gasUsed: bigint; readonly effectiveGasPrice: bigint };

type RpcReceipt = { readonly status: Hex; readonly blockNumber: Hex; readonly gasUsed: Hex; readonly effectiveGasPrice?: Hex };

/** How often a pause between receipt polls looks at the session. */
const SESSION_CHECK_MS = 250;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits one polling interval, throwing within `SESSION_CHECK_MS` of a switch instead of sleeping on. */
async function pause(session: number): Promise<void> {
  for (let waited = 0; waited < RECEIPT_POLL_MS; waited += SESSION_CHECK_MS) {
    await sleep(SESSION_CHECK_MS);
    ensureSession(session);
  }
}

/**
 * Sends one transaction from the connected account through the wallet and polls its receipt until it is mined.
 * The session is checked before sending and every polling round: a switch stops the poll at once and throws naming
 * no hash; the hash and the receipt are shown only while the session holds. A reverted receipt throws.
 */
export async function sendTransaction(conn: Connection, to: Address, data: Hex, value: bigint): Promise<MinedReceipt> {
  ensureSession(conn.session);

  const hash = (await conn.wallet.request({
    method: 'eth_sendTransaction',
    params: [{ from: conn.account, to, data, value: toHex(value) }],
  })) as Hex;

  if (conn.session === wallet.session) note('tx sent', `${hash} from ${conn.account}`);

  let receipt: RpcReceipt | null = null;

  while (receipt === null) {
    ensureSession(conn.session);
    receipt = (await conn.wallet.request({ method: 'eth_getTransactionReceipt', params: [hash] })) as RpcReceipt | null;
    ensureSession(conn.session);

    if (receipt === null) await pause(conn.session);
  }

  const mined = {
    hash,
    blockNumber: hexToNumber(receipt.blockNumber),
    gasUsed: hexToBigInt(receipt.gasUsed),
    effectiveGasPrice: receipt.effectiveGasPrice === undefined ? 0n : hexToBigInt(receipt.effectiveGasPrice),
  };

  note('tx mined', `block ${mined.blockNumber}, status ${receipt.status}, gas ${mined.gasUsed}`);

  if (hexToNumber(receipt.status) !== 1) throw new Error(`transaction ${hash} reverted`);

  return mined;
}

/** Sends a call anyone may send, from the connected account; a failed simulation refuses it. */
export async function sendFromConnected(conn: Connection, call: PreparedCall): Promise<MinedReceipt> {
  if (call.sender !== 'anyone') throw new Error(`the prepared call is the ${call.sender}'s to send`);

  assertSimulated(call);
  note('the connected account sends', `${conn.account} → ${call.target}`);

  return sendTransaction(conn, call.target, call.data, call.value);
}

/**
 * Sends the account's own call or batch as one `executeBySender` from the connected account, which must be an authority
 * of the account. The EOA stand-in refuses: its flows stop before any account self-call.
 */
export async function sendAsAccount(conn: Connection, prepared: PreparedCall | PreparedBatch): Promise<MinedReceipt> {
  const { kit, account } = requireKit();
  const calls = prepared.kind === 'batch' ? prepared.calls : [prepared];

  if (!account.sendsSelfCalls) throw new Error('the EOA stand-in sends no account self-call');

  if (calls.some((call) => call.sender !== 'account')) throw new Error('a call in the batch is not the account\'s to send');

  calls.forEach(assertSimulated);

  const authority = await kit.recoveryAction.isAuthority(conn.account);

  ensureSession(conn.session);

  if (!authority) throw new Error(`the connected account ${conn.account} is not an authority of ${account.address}; connect the account's key`);

  note('the connected account sends executeBySender', `${conn.account} → ${account.address} (${calls.length} call(s))`);

  return sendTransaction(conn, account.address, executeBySenderData(calls), 0n);
}
