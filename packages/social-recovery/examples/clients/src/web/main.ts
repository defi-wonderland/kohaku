import { failure } from '../trace';
import { applyDeployment, createAccount, newSalt, selectAccount, standIn } from './account';
import { prefillDeployment } from './config';
import { fileReply, startGathering, submitAttempt } from './attempt';
import { executeHandover, refreshAttempt } from './execute';
import { guardian, signRequest } from './guardian';
import { holder, refreshState } from './kit';
import { button, copyText, statusLine, traceBox } from './page';
import { runSetup } from './setup';
import { type Connection, connect, connected, injectedWallet } from './wallet';

const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')];

let busy = false;

/** Runs one action at a time, every button off while it runs, showing a failure on the page instead of losing it in the console. */
const guarded = (action: () => Promise<void> | void) => async (): Promise<void> => {
  if (busy) return;

  busy = true;
  statusLine.textContent = 'Working…';

  for (const each of buttons) each.disabled = true;

  try {
    await action();
    statusLine.textContent = statusLine.textContent === 'Working…' ? 'Done.' : statusLine.textContent;
  } catch (error) {
    failure(error);
    statusLine.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    busy = false;

    for (const each of buttons) each.disabled = false;

    button('execute').disabled = !holder.ripe;
  }
};

/** An action that reads the connection cached at the moment it starts. */
const withConnection = (action: (conn: Connection) => Promise<void> | void) => guarded(() => action(connected()));

const actions: Record<string, () => Promise<void>> = {
  'connect': guarded(async () => {
    const injected = injectedWallet();

    if (injected === undefined) throw new Error('no injected wallet: install or enable a browser wallet and reload');

    await connect(injected);
  }),
  'apply': withConnection(applyDeployment),
  'new-salt': guarded(newSalt),
  'create': withConnection(createAccount),
  'select': withConnection(selectAccount),
  'stand-in': withConnection(standIn),
  'refresh-state': withConnection(refreshState),
  'run-setup': withConnection(runSetup),
  'gather': withConnection(startGathering),
  'file-reply': withConnection(fileReply),
  'submit-attempt': withConnection(submitAttempt),
  'refresh-attempt': withConnection(refreshAttempt),
  'execute': withConnection(executeHandover),
  'sign': withConnection(signRequest),
  'copy-reply': guarded(async () => {
    if (guardian.reply === undefined) throw new Error('sign a request first');

    await copyText(JSON.stringify(guardian.reply, null, 2));
  }),
  'clear-trace': guarded(() => {
    traceBox.replaceChildren();
  }),
};

for (const [name, action] of Object.entries(actions)) button(name).addEventListener('click', action);

prefillDeployment();
