import type { Attempt, Hex } from '@kohaku-eth/social-recovery';
import { type Address, decodeFunctionResult, encodeFunctionData, erc20Abi, isAddressEqual, zeroAddress } from 'viem';
import { note, step } from '../trace';
import { holder, requireKit } from './kit';
import { checkLine, executeOut } from './page';
import { walletNativeBalance } from './provider';
import { type MinedReceipt, sendFromConnected } from './send';
import { type Connection, settled } from './wallet';

/** The waiting attempt and the chain's clock, the latest block's timestamp; `ripe` once the clock reached `consumableAfter`. */
async function waitingAttempt(conn: Connection): Promise<{ attempt: Attempt; now: number; ripe: boolean } | undefined> {
  const { kit, provider } = requireKit();
  const state = await settled(conn.session, kit.recovery.recoveryState());
  const now = (await settled(conn.session, provider.block('latest'))).timestamp;

  note('recoveryState', state);

  if (state.attempt.state !== 'Waiting') return undefined;

  return { attempt: state.attempt, now, ripe: now >= state.attempt.consumableAfter };
}

/** Reads the attempt and the chain's clock again; Execute is enabled once the waiting attempt is ripe. */
export async function refreshAttempt(conn: Connection): Promise<void> {
  step('recoveryState and the chain clock');

  const waiting = await waitingAttempt(conn);

  holder.ripe = waiting?.ripe ?? false;

  if (waiting === undefined) {
    executeOut.textContent = 'No attempt is waiting.';

    return;
  }

  const { attempt, now, ripe } = waiting;
  const left = ripe ? 'ripe: Execute is enabled' : `${attempt.consumableAfter - now} s to go; Refresh later`;

  executeOut.textContent = `attempt ${attempt.attemptId}: consumableAfter ${attempt.consumableAfter}, chain time ${now}, ${left}`;
}

/** The opening notification's payload for the attempt, fetched through the event manager from the setup's block on. */
async function openingPayload(conn: Connection, attempt: Attempt): Promise<Hex> {
  const { kit, provider } = requireKit();
  const state = await settled(conn.session, kit.policyManager.stateOf());
  const latest = await settled(conn.session, provider.block(kit.configuration.blockTags.watch));
  const range = { from: state.setupCommittedAtBlock, to: latest.number };

  step('events.fetch (the opening notification)');
  note('range', range);

  const notifications = await settled(conn.session, kit.events.fetch(kit.events.accountFilter(), range));
  const opening = notifications.find((entry) => entry.kind === 'attempt-started' && entry.attemptId === attempt.attemptId);

  if (opening === undefined || opening.kind !== 'attempt-started') throw new Error(`no attempt-started notification for attempt ${attempt.attemptId}`);

  note('attempt-started', { tx: opening.at.transactionHash, payload: opening.payload });

  return opening.payload;
}

/** The payee's balance in the order's asset at one block. */
async function balanceAt(conn: Connection, attempt: Attempt, payee: Address, block: number): Promise<bigint> {
  const { provider } = requireKit();
  const { token } = attempt.order;

  if (isAddressEqual(token, zeroAddress)) return settled(conn.session, walletNativeBalance(conn.wallet)(payee, block));

  const data = encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [payee] });
  const answer = await settled(conn.session, provider.call(token, data, payee, block));

  return decodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', data: answer });
}

/** For a nonzero order, the payee's balance rise across the execute's block, the sender's gas counted back where it is paid natively. */
async function paymentLine(conn: Connection, attempt: Attempt, receipt: MinedReceipt): Promise<{ holds: boolean; message: string }> {
  const { amount, token, payee: ordered } = attempt.order;

  if (amount === 0n) return { holds: true, message: 'zero order: no payment leg' };

  const payee = isAddressEqual(ordered, zeroAddress) ? conn.account : ordered;
  const before = await balanceAt(conn, attempt, payee, receipt.blockNumber - 1);
  const after = await balanceAt(conn, attempt, payee, receipt.blockNumber);
  const gas = isAddressEqual(token, zeroAddress) && isAddressEqual(payee, conn.account) ? receipt.gasUsed * receipt.effectiveGasPrice : 0n;

  note('payee balance before / after', { payee, before, after, gasCountedBack: gas });

  return { holds: after - before + gas === amount, message: `the payee ${payee} received ${amount}` };
}

/**
 * The opening payload through `events.fetch` → prepareExecuteHandover from the connected account → the wallet sends →
 * a check line each: the attempt consumed, the new key an authority, the removed key not, the action still authorized
 * and, for a nonzero order, the payee paid.
 */
export async function executeHandover(conn: Connection): Promise<void> {
  const { kit } = requireKit();
  const waiting = await waitingAttempt(conn);

  if (waiting === undefined) throw new Error('no attempt is waiting');

  if (!waiting.ripe) throw new Error(`the attempt is not ripe for ${waiting.attempt.consumableAfter - waiting.now} s`);

  const { attempt } = waiting;
  const payload = await openingPayload(conn, attempt);
  const handover = kit.codec.decode(payload);

  step(`prepareExecuteHandover (from ${conn.account})`);

  const prepared = await settled(conn.session, kit.recovery.prepareExecuteHandover(attempt, payload, { from: conn.account }));

  note('describes', prepared.describes ?? []);

  const receipt = await sendFromConnected(conn, prepared);

  holder.ripe = false;
  step('checks');

  const state = await settled(conn.session, kit.recovery.recoveryState());
  const lines = [
    { holds: state.attempt.state === 'Consumed', message: 'the attempt is consumed' },
    { holds: await settled(conn.session, kit.recoveryAction.isAuthority(handover.newAuthority)), message: `the new key ${handover.newAuthority} holds the account` },
    ...(handover.removedAuthority === undefined ? [] : [{
      holds: !(await settled(conn.session, kit.recoveryAction.isAuthority(handover.removedAuthority))),
      message: `the old key ${handover.removedAuthority} no longer does`,
    }]),
    { holds: (await settled(conn.session, kit.setup.setupState())).isAuthorized, message: 'the action is still authorized on the account' },
    await paymentLine(conn, attempt, receipt),
  ];

  executeOut.textContent = `executed by ${conn.account} in ${receipt.hash}\n`;

  for (const { holds, message } of lines) {
    checkLine(executeOut, holds, message);
    note(`${holds ? 'ok' : 'FAILED'}: ${message}`);
  }

  const failed = lines.filter((line) => !line.holds).length;

  if (failed > 0) throw new Error(`${failed} check(s) failed after the execute`);
}
