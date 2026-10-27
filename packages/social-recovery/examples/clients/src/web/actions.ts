import { failure, step } from '../trace';
import { connect } from './connect';
import { beginAction, settleAction } from './lifetime';
import { button, statusLine } from './page';
import { type Connection, connected, injectedWallet, wallet } from './wallet';

/** The page's buttons when it loaded, but those marked `data-anytime` (an Abort), which stay enabled while an action runs. */
const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter((each) => each.dataset['anytime'] === undefined);

/** The label of the action running now; `undefined` when none is. */
let running: string | undefined;

/** What each entry re-derives once an action settled, such as a button only its own state enables. */
let afterEach: () => void = () => undefined;

/** The status lines `guarded` itself writes while an action runs; anything else was written by the action. */
const WORKING = 'Working…';
const STILL_WORKING = 'Still working on the previous step';

/** Sets what runs after every action, once the buttons are enabled again. */
export function afterActions(hook: () => void): void {
  afterEach = hook;
}

/**
 * Runs one action at a time, every button off while it runs, showing a failure on the page instead of losing it in the
 * console. A click while another action runs names that action in the status line; the start of each is traced.
 */
export const guarded = (name: string, action: () => Promise<void> | void) => async (): Promise<void> => {
  const label = button(name).textContent?.trim() ?? name;

  if (running !== undefined) {
    statusLine.textContent = `${STILL_WORKING} (${running})… wait or reload`;

    return;
  }

  running = label;

  const life = beginAction();

  statusLine.textContent = WORKING;
  step(`${label} as ${wallet.account ?? 'no connected account'}`);

  for (const each of buttons) each.disabled = true;

  try {
    await action();

    if (life.aborted !== undefined) throw life.aborted;

    const current = statusLine.textContent ?? '';

    statusLine.textContent = current === WORKING || current.startsWith(STILL_WORKING) ? 'Done.' : current;
  } catch (thrown) {
    const error = life.aborted ?? thrown;

    failure(error);
    statusLine.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    settleAction(life);
    running = undefined;

    for (const each of buttons) each.disabled = false;

    afterEach();
  }
};

/** An action that reads the connection cached at the moment it starts. */
export const withConnection = (name: string, action: (conn: Connection) => Promise<void> | void) => guarded(name, () => action(connected()));

/** The Connect action both pages share: the wallet object the browser holds now, the session rules, the Sepolia switch. */
export const connectAction = guarded('connect', async () => {
  const injected = injectedWallet();

  if (injected === undefined) throw new Error('no injected wallet: install or enable a browser wallet and reload');

  await connect(injected);
});

/** Wires each button of the table to its action by element id. */
export function wire(actions: Record<string, () => Promise<void>>): void {
  for (const [name, action] of Object.entries(actions)) button(name).addEventListener('click', action);
}
