import { messageOf } from '../shared/dom';
import { file } from './file';
import { credentialsEdited, gather, readCredentials } from './gather';
import { ui } from './page';

let busy = false;

/** Runs one step at a time, showing a failure on the page instead of losing it in the console. */
const guarded = (step: () => Promise<void> | void) => async (): Promise<void> => {
  if (busy) return;

  busy = true;

  try {
    await step();
  } catch (error) {
    ui.status.textContent = `Error: ${messageOf(error)}`;
  } finally {
    busy = false;
  }
};

ui.credentials.addEventListener('input', credentialsEdited);
ui.readButton.addEventListener('click', guarded(readCredentials));
ui.gatherButton.addEventListener('click', guarded(gather));
ui.fileButton.addEventListener('click', guarded(file));
