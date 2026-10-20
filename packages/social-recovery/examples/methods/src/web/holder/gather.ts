import { requests, type Gathering } from '@kohaku-eth/social-recovery';
import { SAMPLE_CHAIN_ID, SAMPLE_THRESHOLD, SAMPLE_WAIT } from '../../constants';
import { sampleMethodOf } from '../../sample';
import { sampleGathering, sampleSetup } from '../../setup';
import { copyableLine } from '../shared/dom';
import { parseCredentialLines, requestLine } from '../shared/lines';
import { holderTrace, ui } from './page';

/** The two records the holder collects replies into, and the chain their requests carry. */
export const records: { approval?: Gathering; cancellation?: Gathering; chainId: number } = { chainId: SAMPLE_CHAIN_ID };

/** A whole number read from a field, or the fallback where the field is empty. */
const numberOf = (field: HTMLInputElement, fallback: number, what: string): number => {
  const text = field.value.trim();

  if (text === '') return fallback;

  if (!/^\d+$/.test(text)) throw new Error(`${what} is a whole number`);

  return Number(text);
};

/** Reads the pasted credential lines and lists one place per line, each with its "holds code" checkbox. */
export function readCredentials(): void {
  const credentials = parseCredentialLines(ui.credentials.value);

  if (credentials.length === 0) throw new Error('paste one credential line per guardian first');

  ui.places.replaceChildren(
    ...credentials.map((credential, place) => {
      const label = document.createElement('label');
      const box = document.createElement('input');

      box.type = 'checkbox';
      box.dataset['place'] = String(place);
      label.append(box, ` place ${place}: ${sampleMethodOf(credential.method) ?? 'a module this playground does not serve'} (${credential.method}) holds code`);

      return label;
    }),
  );
  holderTrace('the credentials, one per place', credentials);
}

/** The places whose "holds code" box is ticked. */
const holdingCode = (): number[] =>
  [...ui.places.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].filter((box) => box.checked).map((box) => Number(box.dataset['place']));

/** One request line per place of a record, each with Copy. */
const requestLines = (record: Gathering): HTMLElement[] =>
  requests(record).map((request) => copyableLine(requestLine(request), `${record.purpose} request, place ${request.place}`));

/** The sample setup over the credentials, then the approval and cancellation records and their requests per place. */
export function gather(): void {
  const credentials = parseCredentialLines(ui.credentials.value);

  if (credentials.length === 0) throw new Error('paste one credential line per guardian first');

  const chainId = numberOf(ui.chainId, SAMPLE_CHAIN_ID, 'the chain id');
  const setup = sampleSetup(credentials, holderTrace, {
    threshold: numberOf(ui.threshold, SAMPLE_THRESHOLD, 'the threshold'),
    wait: numberOf(ui.wait, SAMPLE_WAIT, 'the wait'),
  });
  const options = { chainId, holdingCode: holdingCode() };
  const approval = sampleGathering(setup, { purpose: 'approval', ...options }, holderTrace);
  const cancellation = sampleGathering(setup, { purpose: 'cancellation', ...options }, holderTrace);

  Object.assign(records, { approval, cancellation, chainId });
  ui.requestsBox.replaceChildren(...requestLines(approval), ...requestLines(cancellation));
  ui.status.textContent = `Requests on chain ${chainId}: send each place its line; paste the replies below.`;
}
