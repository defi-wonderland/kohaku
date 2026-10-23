import type { PreparedBatch, PreparedCall, SetupDraft } from '@kohaku-eth/social-recovery';
import type { Kit } from '../clients';
import { printDescription } from '../describe';
import { check, findings, note, show, step } from '../trace';
import { wholeField } from './config';
import { setupCredentials } from './credentials';
import { noteStandIn, requireKit } from './kit';
import { field, valueOf } from './page';
import { sendAsAccount } from './send';
import { type Connection, ensureSession } from './wallet';

/** The backup password of the setup form, untrimmed; the recovery restores the committed setup with it. */
export function backupPassword(): string {
  const password = field('password').value;

  if (password === '') throw new Error('type the backup password');

  return password;
}

/**
 * The draft the form describes: one clause of the guardians' credentials, the threshold, the wait, attempts a method's
 * stop reaches, no public metadata and an encrypted backup.
 */
export async function setupDraft(kit: Kit): Promise<SetupDraft> {
  const credentials = await setupCredentials(kit, valueOf('guardians'));

  return {
    wait: wholeField('wait'),
    clauses: [{ threshold: wholeField('threshold'), credentials }],
    ignoresPause: false,
    privacy: { publicMetadata: '0x', backup: 'encrypted' },
  };
}

function printPrepared(prepared: PreparedCall | PreparedBatch): void {
  const calls = prepared.kind === 'batch' ? prepared.calls : [prepared];

  note('prepared', prepared.kind === 'batch' ? `batch of ${calls.length}, atomic ${prepared.atomic}` : 'one call');
  note('pinned block', prepared.block.number);

  for (const call of calls) note(`call → ${call.target}`, `sender ${call.sender}, simulation ${show(call.simulation ?? 'skipped')}`);
}

/**
 * draft → validateSetup → describeSetup → prepareCommitSetup → the connected account sends the commit as one
 * `executeBySender` → confirmSetup → setupState. The EOA stand-in stops before sending, as the Node script does.
 */
export async function runSetup(conn: Connection): Promise<void> {
  noteStandIn();

  const { kit, account } = await requireKit();
  const { setup } = kit;
  const draft = await setupDraft(kit);
  const password = backupPassword();
  const sends = account.sendsSelfCalls;

  step(`validateSetup (as ${conn.account})`);

  const validation = await setup.validateSetup(draft);

  ensureSession(conn.session);
  findings(validation);

  if (validation.errors.length > 0 && sends) throw new Error('validateSetup found errors; the setup is not committed');

  step('describeSetup');

  const description = await setup.describeSetup(draft);

  ensureSession(conn.session);
  printDescription(description);
  step('prepareCommitSetup');

  let prepared;

  try {
    prepared = await setup.prepareCommitSetup(draft, password);
  } catch (error) {
    ensureSession(conn.session);

    if (sends) throw error;

    note('prepare refused on the EOA stand-in', error instanceof Error ? error.message : String(error));
  }

  ensureSession(conn.session);

  if (prepared !== undefined) printPrepared(prepared);

  if (prepared === undefined || !sends) {
    note('EOA stand-in: stops before sending');

    return;
  }

  step('send the commit from the connected account');
  await sendAsAccount(conn, prepared);
  ensureSession(conn.session);
  step('confirmSetup');

  const confirmation = await setup.confirmSetup(draft, prepared);

  ensureSession(conn.session);
  note('confirmation', confirmation);
  check(confirmation.landed, 'the setup event landed with the predicted commitment');
  check(confirmation.isAuthorized, 'the action is authorized on the account');
  step('setupState');

  const state = await setup.setupState();

  ensureSession(conn.session);
  note('state', state);
  check(state.hasSetup && state.setupCommitment.toLowerCase() === confirmation.setupCommitment.toLowerCase(), 'the committed setup stands');
}
