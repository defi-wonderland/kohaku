import { type Hex, METHOD_ECDSA_CONFIG_FIELD, type Reply } from '@kohaku-eth/social-recovery';
import { zeroAddress } from 'viem';
import { check, note, step } from '../trace';
import { checkRequest } from '../validation';
import { addressField } from './config';
import { holder, kitForOrder, requireKit } from './kit';
import { copyableBlock, requestsBox, valueOf } from './page';
import { walletNativeBalance } from './provider';
import { sendFromConnected } from './send';
import { backupPassword } from './setup';
import { type Connection, ensureSession } from './wallet';

/** The order amount typed in base units; blank is zero. */
function orderAmount(): bigint {
  const value = valueOf('order-amount');

  if (value === '') return 0n;

  if (!/^\d+$/.test(value)) throw new Error('the order amount must be a whole number in the token\'s base units');

  return BigInt(value);
}

/**
 * initRecoveryGathering handing the account from the connected account to the typed new authority, then shows each
 * approver request as JSON with a Copy button. The gathering stays cached across an account switch.
 */
export async function startGathering(conn: Connection): Promise<void> {
  const handover = { newAuthority: addressField('new-authority'), removedAuthority: conn.account };
  const order = { token: addressField('order-token', zeroAddress), amount: orderAmount(), payee: addressField('order-payee', conn.account) };
  const kit = kitForOrder(order.token);

  step(`initRecoveryGathering (as ${conn.account})`);
  note('handover', handover);
  note('order', order);

  const gathering = await kit.recovery.initRecoveryGathering(
    { password: backupPassword() },
    handover,
    order,
    { window: kit.configuration.requestWindow.default },
  );

  ensureSession(conn.session);

  const requests = kit.recovery.getApproverRequests(gathering);

  holder.gathering = gathering;
  note('gathering', { attemptId: gathering.request.attemptId, validUntil: gathering.request.validUntil, places: gathering.places.length });
  requestsBox.replaceChildren();

  for (const request of requests) {
    const guardian = kit.method.codec.decodeConfig(request.config)[METHOD_ECDSA_CONFIG_FIELD] as Hex;

    copyableBlock(requestsBox, `Place ${request.place}: the request for guardian ${guardian}`, request);
  }

  note('approver requests', requests.length);
}

/** Files one pasted reply into the cached gathering with `addApproverReply`, showing the outcome. */
export function fileReply(conn: Connection): void {
  const { kit } = requireKit();
  const { gathering } = holder;

  if (gathering === undefined) throw new Error('start a gathering first');

  const reply = JSON.parse(valueOf('reply-in')) as Reply;

  step(`addApproverReply place ${reply.place} (holder ${conn.account})`);

  const result = kit.recovery.addApproverReply(gathering, reply);

  note('outcome', result.outcome);

  if (result.outcome === 'refused') {
    note('reason', result.reason);

    return;
  }

  holder.gathering = result.gathering;
}

/**
 * assess → complete → validateRequest (the context assembled as the Node scripts do, through the wallet) →
 * prepareStartAttempt from the connected account → the wallet sends → recoveryState shows the waiting attempt.
 */
export async function submitAttempt(conn: Connection): Promise<void> {
  const { kit, provider } = requireKit();
  const { gathering } = holder;

  if (gathering === undefined) throw new Error('start a gathering first');

  const now = (await provider.block('latest')).timestamp;

  ensureSession(conn.session);
  step('assess');

  const assessment = kit.recovery.assess(gathering, now);

  note('assessment', assessment);
  check(assessment.ruleSatisfied, 'the filed replies satisfy the rule');
  step('complete');

  const request = kit.recovery.complete(gathering, undefined, now);

  if (!('payload' in request)) throw new Error('complete returned a cancellation for an approval gathering');

  note('request', { attemptId: request.attemptId, validUntil: request.validUntil, places: request.proofs.map((proof) => proof.place) });
  await checkRequest(kit, provider, walletNativeBalance(conn.wallet), request, now, () => ensureSession(conn.session));
  ensureSession(conn.session);
  step(`prepareStartAttempt (from ${conn.account})`);

  const prepared = await kit.recovery.prepareStartAttempt(request, now, { from: conn.account });

  ensureSession(conn.session);
  await sendFromConnected(conn, prepared);
  ensureSession(conn.session);
  step('recoveryState');

  const state = await kit.recovery.recoveryState();

  ensureSession(conn.session);
  note('attempt', state.attempt);
  check(state.attempt.state === 'Waiting' && state.attempt.attemptId === request.attemptId, 'the attempt is waiting');
  holder.gathering = undefined;
}
