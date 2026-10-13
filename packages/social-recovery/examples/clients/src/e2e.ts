import { runCancel } from './cancel';
import { checkArmingBatch } from './checks';
import { loadEnv } from './env';
import { runRecovery } from './recovery';
import { runSetup } from './setup';
import { runIfMain } from './run';
import { check, step } from './trace';

/**
 * Setup, recovery (default wait mode, polling to the end of the wait) and cancel in one run, each asserting on the
 * chain's answers; any failure exits 1. The EOA stand-in runs every flow's reads and prepares and sends nothing.
 */
async function e2e(): Promise<void> {
  const env = loadEnv();
  const sends = env.accountMode !== 'eoa';

  step('e2e: setup');

  const setup = await runSetup(env);

  check(!sends || setup.confirmation?.landed === true, 'setup committed and confirmed');
  checkArmingBatch(setup);
  step('e2e: recovery');

  const executed = await runRecovery({ twoStep: false }, env);

  check(!sends || executed, 'recovery executed the handover in one run');
  step('e2e: cancel');
  await runCancel(env);
  step('e2e: done');
}

runIfMain(import.meta.url, e2e);
