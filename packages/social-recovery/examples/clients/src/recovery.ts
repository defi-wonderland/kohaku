import type { Attempt } from '@kohaku-eth/social-recovery';
import { chainNow, openAttempt } from './attempt';
import type { Env } from './env';
import { executeAttempt } from './handover';
import { openSession, type Session } from './session';
import { note, runIfMain, step } from './trace';

/** `twoStep` starts the attempt and exits; a later run executes it once ripe. */
export type RecoveryOptions = { readonly twoStep: boolean };

const POLL_MS = 12_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether the attempt is spendable now, polling the chain's clock up to the limit in the default mode. */
async function ripe(session: Session, attempt: Attempt, options: RecoveryOptions): Promise<boolean> {
  const { configuration } = session.kit;
  let now = await chainNow(session);

  step('wait');
  note('consumableAfter', attempt.consumableAfter);

  if (session.env.wait < configuration.shortWait) {
    note('warning setup.wait-short', { wait: session.env.wait, shortWait: configuration.shortWait });
  }

  if (now >= attempt.consumableAfter) return true;

  if (options.twoStep || attempt.consumableAfter - now > session.env.pollLimit) {
    note(`not ripe for ${attempt.consumableAfter - now} s; run the recovery again after ${new Date(attempt.consumableAfter * 1000).toISOString()}`);

    return false;
  }

  while (now < attempt.consumableAfter) {
    note(`chain time ${now}, ${attempt.consumableAfter - now} s to go`);
    await sleep(Math.min(POLL_MS, (attempt.consumableAfter - now) * 1000 + 1000));
    now = await chainNow(session);
  }

  return true;
}

/**
 * The recovery flow. With no attempt waiting it opens one (gathering → submission); then it waits and executes the
 * handover, or, in two-step mode or past the poll limit, exits for a later run that resumes the waiting attempt.
 * Returns whether the handover was executed.
 */
export async function runRecovery(options: RecoveryOptions, given?: Env): Promise<boolean> {
  const session = await openSession(given);
  const { recovery } = session.kit;

  step('recoveryState');

  const state = await recovery.recoveryState();

  note('state', state);

  if (!session.account.sendsSelfCalls && state.setupNonce === 0n) {
    note('EOA stand-in without a setup: reads only, stops here');

    return false;
  }

  const attempt = state.attempt.state === 'Waiting' ? state.attempt : await openAttempt(session);

  if (state.attempt.state === 'Waiting') note(`resuming the waiting attempt ${attempt.attemptId}`);

  if (!(await ripe(session, attempt, options))) return false;

  await executeAttempt(session, attempt);

  return true;
}

runIfMain(import.meta.url, async () => {
  await runRecovery({ twoStep: process.argv.includes('--two-step') });
});
