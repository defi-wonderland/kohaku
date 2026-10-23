import type { Attempt, AttemptRequest, CancelRequest, Gathering, Moment } from '@kohaku-eth/social-recovery';
import { gatherReplies } from './guardians';
import { sendFromSponsor } from './send';
import { type Session, sponsorAddress } from './session';
import { check, note, step } from './trace';
import { checkRequest, type NativeBalance } from './validation';

/** The native balance through the session's viem client. */
const nativeBalanceOf = (session: Session): NativeBalance => (address, blockNumber) =>
  session.client.getBalance({ address, blockNumber: BigInt(blockNumber) });

/** The chain's own clock, the latest block's timestamp, the moment every judgment compares against. */
export const chainNow = async (session: Session): Promise<Moment> => (await session.provider.block('latest')).timestamp;

/** The guardians answer, then `assess` and `complete` turn the gathering into the request to submit. */
export async function assembled(session: Session, start: Gathering): Promise<{ request: AttemptRequest | CancelRequest; now: Moment }> {
  const { env, kit } = session;
  const gathering = await gatherReplies(kit.recovery, kit.orchestrator, start, env.guardianKeys, env.threshold);
  const now = await chainNow(session);

  step('assess');

  const assessment = kit.recovery.assess(gathering, now);

  note('assessment', assessment);
  check(assessment.ruleSatisfied, 'the filed replies satisfy the rule');
  step('complete');

  const request = kit.recovery.complete(gathering, undefined, now);

  note('request', { attemptId: request.attemptId, validUntil: request.validUntil, places: request.proofs.map((proof) => proof.place) });
  await checkRequest(kit, session.provider, nativeBalanceOf(session), request, now);

  return { request, now };
}

/**
 * Opens a recovery attempt handing the account from the key it holds now to the other holder key:
 * initRecoveryGathering → the guardians sign → assess → complete → validateRequest → prepareStartAttempt → the sponsor sends.
 */
export async function openAttempt(session: Session): Promise<Attempt> {
  const { env, kit, holders } = session;
  const sponsor = sponsorAddress(session);
  const handover = { newAuthority: holders.next, removedAuthority: holders.current };
  const order = { token: env.orderToken, amount: env.orderAmount, payee: env.orderPayee ?? sponsor };

  step('initRecoveryGathering');
  note('handover', handover);
  note('order', order);

  const gathering = await kit.recovery.initRecoveryGathering(
    { password: env.backupPassword },
    handover,
    order,
    { window: kit.configuration.requestWindow.default },
  );

  note('gathering', { attemptId: gathering.request.attemptId, validUntil: gathering.request.validUntil, places: gathering.places.length });

  const { request, now } = await assembled(session, gathering);

  if (!('payload' in request)) throw new Error('complete returned a cancellation for an approval gathering');

  step('prepareStartAttempt');

  const prepared = await kit.recovery.prepareStartAttempt(request, now, { from: sponsor });

  await sendFromSponsor(session, prepared);
  step('recoveryState');

  const state = await kit.recovery.recoveryState();

  note('attempt', state.attempt);
  check(state.attempt.state === 'Waiting' && state.attempt.attemptId === request.attemptId, 'the attempt is waiting');

  return state.attempt;
}
