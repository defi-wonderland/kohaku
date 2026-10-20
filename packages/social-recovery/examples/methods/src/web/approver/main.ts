import type { Hex } from '@kohaku-eth/social-recovery';
import { SAMPLE_CHAIN_ID } from '../../constants';
import type { SampleMethod } from '../../sample';
import { connectButton, connectionLine, pageTrace, signButton, verdictLine } from '../page';
import { ensureSession, injectedWallet, listen, requestConnection, reset, state } from '../session';
import { messageOf } from '../shared/dom';
import { abortRun, currentChainId, describe, enrol, PAGES, sign } from './flow';
import { ui } from './page';

const picked = (): SampleMethod => ui.methodPicker.value as SampleMethod;

/** Shows the picked method's fields and what its testing switch simulates; zkPassport has no switch. */
function showMethod(): void {
  const page = PAGES[picked()];

  for (const [name, fieldset] of Object.entries(ui.fieldsets)) fieldset.hidden = name !== picked();

  ui.testing.disabled = page.testingLabel === undefined;
  ui.testing.parentElement?.toggleAttribute('hidden', page.testingLabel === undefined);
  ui.testingLabel.textContent = page.testingLabel ?? '';
  ui.realLabel.textContent = page.realLabel;
}

/** States the chain the page builds for. */
function showChain(): void {
  ui.chainLine.textContent =
    state.chainId === undefined
      ? `Chain id ${SAMPLE_CHAIN_ID}: no wallet connected`
      : `Chain id ${currentChainId()}: the connected wallet's chain`;
}

/** Connects the injected wallet under the session rules, and reads whether its address holds code for the holder to know. */
async function connect(): Promise<void> {
  const wallet = injectedWallet();

  if (wallet === undefined) throw new Error('no injected wallet: install or enable a browser wallet and reload');

  reset();
  listen(wallet);

  const session = state.session;
  const { guardian, chainId } = await requestConnection(wallet, session);

  pageTrace('connected guardian (eth_requestAccounts, re-read with eth_accounts)', guardian);
  pageTrace("the wallet's chain id (eth_chainId, read twice): the chain this page builds for", chainId);

  const code = (await wallet.request({ method: 'eth_getCode', params: [guardian, 'latest'] })) as Hex | null;
  const holdsCode = typeof code === 'string' && code !== '0x' && code !== '0x0';

  ensureSession(session);
  pageTrace("eth_getCode(guardian, 'latest'): whether the holder ticks holds code for your place", holdsCode);
  Object.assign(state, { wallet });
  connectionLine.textContent = `Connected ${guardian} on chain ${chainId}; holds code: ${holdsCode}`;
}

const buttons = (): HTMLButtonElement[] => [connectButton, signButton, ui.enrolButton, ui.describeButton];

/** Runs one step at a time, the action buttons off while it runs, showing a failure on the page instead of losing it in the console. */
const guarded = (step: () => Promise<void> | void) => async (): Promise<void> => {
  if (state.busy) return;

  state.busy = true;
  buttons().forEach((button) => (button.disabled = true));
  verdictLine.textContent = '';
  ui.progressLine.textContent = '';

  try {
    await step();
  } catch (error) {
    verdictLine.textContent = `Error: ${messageOf(error)}`;
  } finally {
    state.busy = false;
    buttons().forEach((button) => (button.disabled = false));
    showChain();
  }
};

ui.methodPicker.addEventListener('change', showMethod);
connectButton.addEventListener('click', guarded(connect));
ui.enrolButton.addEventListener('click', guarded(() => enrol(picked())));
ui.describeButton.addEventListener('click', guarded(() => {
  describe();
}));
signButton.addEventListener('click', guarded(sign));
ui.abortButton.addEventListener('click', abortRun);
showMethod();
showChain();
signButton.disabled = false;
