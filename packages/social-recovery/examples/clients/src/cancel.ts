import type { Attempt, CancelledBy } from '@kohaku-eth/social-recovery';
import { assembled, openAttempt } from './attempt';
import type { Env } from './env';
import { sendAsAccount, sendFromSponsor } from './send';
import { openSession, type Session, sponsorAddress } from './session';
import { check, note, runIfMain, step } from './trace';

/** The live attempt, or a fresh one opened for the cancel to stop. */
async function waitingAttempt(session: Session): Promise<Attempt> {
  const state = await session.kit.recovery.recoveryState();

  if (state.attempt.state === 'Waiting') {
    note(`cancelling the waiting attempt ${state.attempt.attemptId}`);

    return state.attempt;
  }

  return openAttempt(session);
}

/** The attempt is cancelled on chain and its notification names the door that cancelled it. */
async function checkCancelled(session: Session, attempt: Attempt, door: CancelledBy): Promise<void> {
  const { kit, provider } = session;

  step('recoveryState');

  const state = await kit.recovery.recoveryState();

  note('attempt', state.attempt);
  check(state.attempt.attemptId === attempt.attemptId && state.attempt.state === 'Cancelled', `attempt ${attempt.attemptId} is cancelled`);

  const from = (await kit.policyManager.stateOf()).setupCommittedAtBlock;
  const to = (await provider.block(kit.configuration.blockTags.watch)).number;
  const notifications = await kit.events.fetch(kit.events.accountFilter(), { from, to });
  const cancelled = notifications.find((entry) => entry.kind === 'attempt-cancelled' && entry.attemptId === attempt.attemptId);

  check(cancelled?.kind === 'attempt-cancelled' && cancelled.cancelledBy === door, `the attempt-cancelled notification names ${door}`);
}

/** By owner: prepareCancelByOwner → the account sends it. */
async function cancelByOwner(session: Session): Promise<void> {
  const attempt = await waitingAttempt(session);

  step('prepareCancelByOwner');

  const prepared = await session.kit.recovery.prepareCancelByOwner();

  await sendAsAccount(session, prepared);
  await checkCancelled(session, attempt, 'cancelByOwner');
}

/** By proofs over a fresh attempt: initCancelGathering → the guardians sign → assess → complete → validateRequest → prepareCancelByProofs → the sponsor sends. */
async function cancelByProofs(session: Session): Promise<void> {
  const { env, kit } = session;
  const attempt = await waitingAttempt(session);

  step('initCancelGathering');

  const gathering = await kit.recovery.initCancelGathering({ password: env.backupPassword }, { window: kit.configuration.cancelWindow });
  const { request, now } = await assembled(session, gathering);

  if ('payload' in request) throw new Error('complete returned an opening request for a cancellation gathering');

  step('prepareCancelByProofs');

  const prepared = await kit.recovery.prepareCancelByProofs(request, now, { from: sponsorAddress(session) });

  await sendFromSponsor(session, prepared);
  await checkCancelled(session, attempt, 'cancelByProofs');
}

/** The cancel flow: by owner, then by proofs, each over an attempt opened for it; the EOA stand-in prepares only. */
export async function runCancel(given?: Env): Promise<void> {
  const session = await openSession(given);

  if (!session.account.sendsSelfCalls) {
    step('prepareCancelByOwner (EOA stand-in: prepared, not sent)');

    const prepared = await session.kit.recovery.prepareCancelByOwner();

    note('prepared', { target: prepared.target, sender: prepared.sender, simulation: prepared.simulation ?? 'skipped' });

    return;
  }

  await cancelByOwner(session);
  await cancelByProofs(await openSession(session.env));
}

runIfMain(import.meta.url, async () => {
  await runCancel();
});
