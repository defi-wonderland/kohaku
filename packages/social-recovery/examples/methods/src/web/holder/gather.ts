import { requests, type Credential, type Gathering } from '@kohaku-eth/social-recovery';
import { SAMPLE_CHAIN_ID, SAMPLE_WAIT } from '../../constants';
import { sampleMethodOf } from '../../sample';
import { sampleGathering, sampleSetup } from '../../setup';
import { copyableLine } from '../shared/dom';
import { credentialLine, parseCredentialLines, requestLine } from '../shared/lines';
import { holderTrace, ui } from './page';

/** The two records the holder collects replies into, and the chain their requests carry. */
export const records: { approval?: Gathering; cancellation?: Gathering; chainId: number } = { chainId: SAMPLE_CHAIN_ID };

/** A whole number read from a field, or the fallback where the field is empty. */
const numberOf = <F extends number | undefined>(field: HTMLInputElement, fallback: F, what: string): number | F => {
  const text = field.value.trim();

  if (text === '') return fallback;

  if (!/^\d+$/.test(text)) throw new Error(`${what} is a whole number`);

  return Number(text);
};

/** The checkboxes of the listed places, in place order. */
const boxes = (): HTMLInputElement[] => [...ui.places.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];

/** Lists one place per credential, each with its "holds code" box; a box keeps its tick only where its place keeps the same credential. */
function listPlaces(credentials: readonly Credential[]): void {
  const ticked = new Set(boxes().filter((box) => box.checked).map((box) => `${box.dataset['place']} ${box.dataset['credential']}`));

  ui.places.replaceChildren(
    ...credentials.map((credential, place) => {
      const label = document.createElement('label');
      const box = document.createElement('input');

      box.type = 'checkbox';
      box.dataset['place'] = String(place);
      box.dataset['credential'] = credentialLine(credential);
      box.checked = ticked.has(`${place} ${box.dataset['credential']}`);
      label.append(box, ` place ${place}: ${sampleMethodOf(credential.method) ?? 'a module this playground does not serve'} (${credential.method}) holds code`);

      return label;
    }),
  );
}

/** Reads the pasted credential lines and lists one place per line, each with its "holds code" checkbox. */
export function readCredentials(): void {
  const credentials = parseCredentialLines(ui.credentials.value);

  if (credentials.length === 0) throw new Error('paste one credential line per guardian first');

  listPlaces(credentials);
  holderTrace('the credentials, one per place', credentials);
}

/** Rebuilds the places whenever the credential text changes; text that does not parse lists no place until it does. */
export function credentialsEdited(): void {
  let credentials: Credential[];

  try {
    credentials = parseCredentialLines(ui.credentials.value);
  } catch {
    credentials = [];
  }

  listPlaces(credentials);
}

/** The places whose "holds code" box is ticked, refused when the boxes describe another list than the credentials gathered. */
function holdingCode(credentials: readonly Credential[]): number[] {
  const listed = boxes();

  if (listed.length !== credentials.length) {
    throw new Error(`the "holds code" boxes list ${listed.length} places but ${credentials.length} credentials are pasted: read the credentials again`);
  }

  if (listed.some((box, place) => box.dataset['credential'] !== credentialLine(credentials[place] as Credential))) {
    throw new Error('the "holds code" boxes describe other credentials than the ones pasted: read the credentials again');
  }

  return listed.filter((box) => box.checked).map((box) => Number(box.dataset['place']));
}

/** One request line per place of a record, each with Copy. */
const requestLines = (record: Gathering): HTMLElement[] =>
  requests(record).map((request) => copyableLine(requestLine(request), `${record.purpose} request, place ${request.place}`));

/** The sample setup over the credentials, then the approval and cancellation records and their requests per place. */
export function gather(): void {
  const credentials = parseCredentialLines(ui.credentials.value);

  if (credentials.length === 0) throw new Error('paste one credential line per guardian first');

  const chainId = numberOf(ui.chainId, SAMPLE_CHAIN_ID, 'the chain id');
  const threshold = numberOf(ui.threshold, undefined, 'the threshold');

  if (threshold !== undefined && threshold > credentials.length) {
    throw new Error(`the threshold ${threshold} is above the ${credentials.length} credentials pasted: no setup can meet it`);
  }

  const holding = holdingCode(credentials);
  const setup = sampleSetup(credentials, holderTrace, { threshold, wait: numberOf(ui.wait, SAMPLE_WAIT, 'the wait') });
  const options = { chainId, holdingCode: holding };
  const approval = sampleGathering(setup, { purpose: 'approval', ...options }, holderTrace);
  const cancellation = sampleGathering(setup, { purpose: 'cancellation', ...options }, holderTrace);

  Object.assign(records, { approval, cancellation, chainId });
  ui.requestsBox.replaceChildren(...requestLines(approval), ...requestLines(cancellation));
  ui.status.textContent = `Requests on chain ${chainId}: send each place its line; paste the replies below.`;
}
