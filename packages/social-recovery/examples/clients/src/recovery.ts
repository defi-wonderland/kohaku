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

/** The SDK's own wait findings over the committed setup, restored from the backup, so a resumed attempt is judged by its wait. */
async function committedWaitFindings(session: Session): Promise<void> {
  const { setup } = session.kit;

  step('getSetup (the committed setup) → validateSetup, its wait findings');

  const committed = await setup.getSetup({ password: session.env.backupPassword });
  const draft = { ...committed, privacy: { publicMetadata: '0x', backup: 'encrypted' } } as const;
  const result = await setup.validateSetup(draft);
  const waits = result.warnings.filter((warning) => warning.code === 'setup.wait-short' || warning.code === 'setup.wait-zero');

  note('committed wait', committed.wait);

  for (const warning of waits) note(`warning ${warning.code}`, warning.values);
}

/** Whether the attempt is spendable now; the default mode polls the chain's clock until it is, however long that takes. */
async function ripe(session: Session, attempt: Attempt, options: RecoveryOptions): Promise<boolean> {
  let now = await chainNow(session);

  step('wait');
  note('consumableAfter', attempt.consumableAfter);

  if (now >= attempt.consumableAfter) return true;

  if (options.twoStep) {
    note(`not ripe for ${attempt.consumableAfter - now} s; run the recovery again after ${new Date(attempt.consumableAfter * 1000).toISOString()}`);

    return false;
  }

  note('polling until the wait is over (Ctrl-C stops; a later run resumes the waiting attempt)');

  while (now < attempt.consumableAfter) {
    note(`chain time ${now}, ${attempt.consumableAfter - now} s to go`);
    await sleep(Math.min(POLL_MS, (attempt.consumableAfter - now) * 1000 + 1000));
    now = await chainNow(session);
  }

  return true;
}

/**
 * The recovery flow. With no attempt waiting it opens one (gathering → submission); then it waits and executes the
 * handover, or, in two-step mode, exits for a later run that resumes the waiting attempt.
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

  await committedWaitFindings(session);

  if (!(await ripe(session, attempt, options))) return false;

  await executeAttempt(session, attempt);

  return true;
}

runIfMain(import.meta.url, async () => {
  await runRecovery({ twoStep: process.argv.includes('--two-step') });
});
