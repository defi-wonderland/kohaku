import { failure, step } from '../trace';
import { actionState, beginAction } from './chain';
import { applyDeployment, createAccount, newSalt, selectAccount, standIn } from './account';
import { prefillDeployment } from './config';
import { fileReply, startGathering, submitAttempt } from './attempt';
import { executeHandover, refreshAttempt } from './execute';
import { guardian, signRequest } from './guardian';
import { holder, refreshState } from './kit';
import { button, copyText, statusLine, traceBox } from './page';
import { runSetup } from './setup';
import { type Connection, connect, connected, injectedWallet, wallet } from './wallet';

const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')];

/** The label of the action running now; `undefined` when none is. */
let running: string | undefined;

/** The status lines `guarded` itself writes while an action runs; anything else was written by the action. */
const WORKING = 'Working…';
const STILL_WORKING = 'Still working on the previous step';

/**
 * Runs one action at a time, every button off while it runs, showing a failure on the page instead of losing it in the
 * console. A click while another action runs names that action in the status line; the start of each is traced.
 */
const guarded = (name: string, action: () => Promise<void> | void) => async (): Promise<void> => {
  const label = button(name).textContent?.trim() ?? name;

  if (running !== undefined) {
    statusLine.textContent = `${STILL_WORKING} (${running})… wait or reload`;

    return;
  }

  running = label;
  beginAction();
  statusLine.textContent = WORKING;
  step(`${label} as ${wallet.account ?? 'no connected account'}`);

  for (const each of buttons) each.disabled = true;

  try {
    await action();

    if (actionState.aborted !== undefined) throw actionState.aborted;

    const current = statusLine.textContent ?? '';

    statusLine.textContent = current === WORKING || current.startsWith(STILL_WORKING) ? 'Done.' : current;
  } catch (thrown) {
    const error = actionState.aborted ?? thrown;

    failure(error);
    statusLine.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    running = undefined;

    for (const each of buttons) each.disabled = false;

    button('execute').disabled = !holder.ripe;
  }
};

/** An action that reads the connection cached at the moment it starts. */
const withConnection = (name: string, action: (conn: Connection) => Promise<void> | void) => guarded(name, () => action(connected()));

const actions: Record<string, () => Promise<void>> = {
  'connect': guarded('connect', async () => {
    const injected = injectedWallet();

    if (injected === undefined) throw new Error('no injected wallet: install or enable a browser wallet and reload');

    await connect(injected);
  }),
  'apply': withConnection('apply', applyDeployment),
  'new-salt': guarded('new-salt', newSalt),
  'create': withConnection('create', createAccount),
  'select': withConnection('select', selectAccount),
  'stand-in': withConnection('stand-in', standIn),
  'refresh-state': withConnection('refresh-state', refreshState),
  'run-setup': withConnection('run-setup', runSetup),
  'gather': withConnection('gather', startGathering),
  'file-reply': withConnection('file-reply', fileReply),
  'submit-attempt': withConnection('submit-attempt', submitAttempt),
  'refresh-attempt': withConnection('refresh-attempt', refreshAttempt),
  'execute': withConnection('execute', executeHandover),
  'sign': withConnection('sign', signRequest),
  'copy-reply': guarded('copy-reply', async () => {
    if (guardian.reply === undefined) throw new Error('sign a request first');

    await copyText(JSON.stringify(guardian.reply, null, 2));
  }),
  'clear-trace': guarded('clear-trace', () => {
    traceBox.replaceChildren();
  }),
};

for (const [name, action] of Object.entries(actions)) button(name).addEventListener('click', action);

prefillDeployment();
