import { METHOD_ECDSA_CONFIG_FIELD, type PreparedBatch, type PreparedCall, type SetupDraft } from '@kohaku-eth/social-recovery';
import { type Address, getAddress, isAddress } from 'viem';
import type { Kit } from '../clients';
import { printDescription } from '../describe';
import { check, findings, note, show, step } from '../trace';
import { wholeField } from './config';
import { requireKit } from './kit';
import { field, valueOf } from './page';
import { sendAsAccount } from './send';
import { type Connection, settled } from './wallet';

/** The guardian addresses typed in the setup form, one per line or comma-separated. */
function guardianAddresses(): readonly Address[] {
  const entries = valueOf('guardians').split(/[\s,]+/).filter((entry) => entry !== '');

  if (entries.length === 0) throw new Error('name at least one guardian address');

  if (entries.some((entry) => !isAddress(entry, { strict: false }))) throw new Error('every guardian must be an address');

  return entries.map((entry) => getAddress(entry));
}

/** The backup password of the setup form, untrimmed; the recovery restores the committed setup with it. */
export function backupPassword(): string {
  const password = field('password').value;

  if (password === '') throw new Error('type the backup password');

  return password;
}

/**
 * The draft the form describes: one clause of wallet guardians, the threshold, the wait, attempts a method's stop
 * reaches, no public metadata and an encrypted backup.
 */
export function setupDraft(kit: Kit): SetupDraft {
  const credentials = guardianAddresses().map((address, index) => ({
    method: kit.descriptor.methodEcdsa,
    config: kit.method.codec.encodeConfig({ [METHOD_ECDSA_CONFIG_FIELD]: address }),
    label: `guardian-${index + 1}`,
  }));

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
  const { kit, account } = requireKit();
  const { setup } = kit;
  const draft = setupDraft(kit);
  const password = backupPassword();
  const sends = account.sendsSelfCalls;

  step(`validateSetup (as ${conn.account})`);

  const validation = await settled(conn.session, setup.validateSetup(draft));

  findings(validation);

  if (validation.errors.length > 0 && sends) throw new Error('validateSetup found errors; the setup is not committed');

  step('describeSetup');
  printDescription(await settled(conn.session, setup.describeSetup(draft)));
  step('prepareCommitSetup');

  const prepared = await settled(conn.session, setup.prepareCommitSetup(draft, password).catch((error: unknown) => {
    if (sends) throw error;

    note('prepare refused on the EOA stand-in', error instanceof Error ? error.message : String(error));

    return undefined;
  }));

  if (prepared !== undefined) printPrepared(prepared);

  if (prepared === undefined || !sends) {
    note('EOA stand-in: stops before sending');

    return;
  }

  step('send the commit from the connected account');
  await sendAsAccount(conn, prepared);
  step('confirmSetup');

  const confirmation = await settled(conn.session, setup.confirmSetup(draft, prepared));

  note('confirmation', confirmation);
  check(confirmation.landed, 'the setup event landed with the predicted commitment');
  check(confirmation.isAuthorized, 'the action is authorized on the account');
  step('setupState');

  const state = await settled(conn.session, setup.setupState());

  note('state', state);
  check(state.hasSetup && state.setupCommitment.toLowerCase() === confirmation.setupCommitment.toLowerCase(), 'the committed setup stands');
}
