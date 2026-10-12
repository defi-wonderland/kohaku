import type { PreparedBatch, PreparedCall, SetupConfirmation, SetupState } from '@kohaku-eth/social-recovery';
import { setupDraft } from './draft';
import type { Env } from './env';
import { sendAsAccount } from './send';
import { openSession } from './session';
import { check, findings, note, runIfMain, step } from './trace';

/** What a setup run ends with; `confirmation` is absent where the EOA stand-in stopped before sending. */
export type SetupOutcome = { readonly state: SetupState; readonly confirmation?: SetupConfirmation };

function printPrepared(prepared: PreparedCall | PreparedBatch): void {
  const calls = prepared.kind === 'batch' ? prepared.calls : [prepared];

  note('prepared', prepared.kind === 'batch' ? `batch of ${calls.length}, atomic ${prepared.atomic}` : 'one call');
  note('pinned block', prepared.block.number);

  for (const call of calls) note(`call → ${call.target}`, `sender ${call.sender}, simulation ${JSON.stringify(call.simulation ?? 'skipped')}`);
}

/** The setup flow: draft → validateSetup → describeSetup → prepareCommitSetup → the account sends → confirmSetup → setupState. */
export async function runSetup(given?: Env): Promise<SetupOutcome> {
  const session = await openSession(given);
  const { setup } = session.kit;
  const draft = setupDraft(session);
  const sends = session.account.sendsSelfCalls;

  step('validateSetup');

  const validation = await setup.validateSetup(draft);

  findings(validation);

  if (validation.errors.length > 0 && sends) throw new Error('validateSetup found errors; the setup is not committed');

  step('describeSetup');

  const description = await setup.describeSetup(draft);

  note('rule', description.rule);
  note('wait', description.wait);
  note('wallet guardians', description.parties.walletGuardians);
  note('candidate keys', description.candidateKeys);

  step('prepareCommitSetup');

  const prepared = await setup.prepareCommitSetup(draft, session.env.backupPassword).catch((error: unknown) => {
    if (sends) throw error;

    note('prepare refused on the EOA stand-in', error instanceof Error ? error.message : String(error));

    return undefined;
  });

  if (prepared !== undefined) printPrepared(prepared);

  if (prepared === undefined || !sends) {
    note('EOA stand-in: stops before sending');
    step('setupState');

    const state = await setup.setupState();

    note('state', state);

    return { state };
  }

  step('send the commit from the holder');
  await sendAsAccount(session, prepared);
  step('confirmSetup');

  const confirmation = await setup.confirmSetup(draft, prepared);

  note('confirmation', confirmation);
  check(confirmation.landed, 'the setup event landed with the predicted commitment');
  check(confirmation.isAuthorized, 'the action is authorized on the account');
  step('setupState');

  const state = await setup.setupState();

  note('state', state);
  check(state.hasSetup && state.setupCommitment.toLowerCase() === confirmation.setupCommitment.toLowerCase(), 'the committed setup stands');

  return { state, confirmation };
}

runIfMain(import.meta.url, async () => {
  await runSetup();
});
