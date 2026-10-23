import type { Attempt, Hex } from '@kohaku-eth/social-recovery';
import { checkPayment, checkStillAuthorized } from './checks';
import { sendFromSponsor } from './send';
import { type Session, sponsorAddress } from './session';
import { check, note, step } from './trace';

/** The opening notification's payload for the attempt, fetched through the event manager from the setup's block on. */
async function openingPayload(session: Session, attempt: Attempt): Promise<Hex> {
  const { kit, provider } = session;
  const state = await kit.policyManager.stateOf();
  const latest = await provider.block(kit.configuration.blockTags.watch);
  const range = { from: state.setupCommittedAtBlock, to: latest.number };

  step('events.fetch (the opening notification)');
  note('range', range);

  const notifications = await kit.events.fetch(kit.events.accountFilter(), range);
  const opening = notifications.find((entry) => entry.kind === 'attempt-started' && entry.attemptId === attempt.attemptId);

  if (opening === undefined || opening.kind !== 'attempt-started') throw new Error(`no attempt-started notification for attempt ${attempt.attemptId}`);

  note('attempt-started', { tx: opening.at.transactionHash, payload: opening.payload });

  return opening.payload;
}

/**
 * prepareExecuteHandover → the sponsor sends → the attempt is consumed, the keys moved, the action still authorized
 * and, for a nonzero order, the payee paid.
 */
export async function executeAttempt(session: Session, attempt: Attempt): Promise<void> {
  const { kit } = session;
  const payload = await openingPayload(session, attempt);
  const handover = kit.codec.decode(payload);

  step('prepareExecuteHandover');

  const prepared = await kit.recovery.prepareExecuteHandover(attempt, payload, { from: sponsorAddress(session) });

  note('describes', prepared.describes ?? []);

  const receipt = await sendFromSponsor(session, prepared);

  step('recoveryState');

  const state = await kit.recovery.recoveryState();

  note('attempt', state.attempt);
  note('removed key', state.removedKey);
  check(state.attempt.state === 'Consumed', 'the attempt is consumed');
  check(await kit.recoveryAction.isAuthority(handover.newAuthority), `the new key ${handover.newAuthority} holds the account`);

  if (handover.removedAuthority !== undefined) {
    check(!(await kit.recoveryAction.isAuthority(handover.removedAuthority)), `the old key ${handover.removedAuthority} no longer does`);
  }

  await checkStillAuthorized(session);
  await checkPayment(session, attempt, receipt);
}
