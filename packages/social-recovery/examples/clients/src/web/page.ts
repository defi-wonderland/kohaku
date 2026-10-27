import { setTraceSink, show } from '../trace';

const element = <T extends HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);

  if (found === null) throw new Error(`missing element ${selector}`);

  return found;
};

/** The input or textarea with this element id. */
export const field = (name: string): HTMLInputElement | HTMLTextAreaElement => element(`#${name}`);

/** The trimmed value of a form field; empty when blank. */
export const valueOf = (name: string): string => field(name).value.trim();

export const button = (name: string): HTMLButtonElement => element<HTMLButtonElement>(`#${name}`);

/**
 * An output area of one of the two pages: the element where this page has it, else a detached one of the same tag,
 * so a module both pages import writes to nothing on the page that lacks the area.
 */
const area = <T extends HTMLElement>(selector: string, tag: string): T =>
  document.querySelector<T>(selector) ?? (document.createElement(tag) as T);

export const connectionLine = element<HTMLParagraphElement>('#connection');
export const statusLine = element<HTMLParagraphElement>('#status');
export const traceBox = element<HTMLPreElement>('#trace');
export const accountLine = area<HTMLParagraphElement>('#account-line', 'p');
export const stateOut = area<HTMLPreElement>('#state-out', 'pre');
export const requestsBox = area<HTMLDivElement>('#requests', 'div');
export const executeOut = area<HTMLPreElement>('#execute-out', 'pre');
export const replyOut = area<HTMLPreElement>('#reply-out', 'pre');
export const credentialOut = area<HTMLPreElement>('#credential-out', 'pre');
export const descriptionOut = area<HTMLPreElement>('#description-out', 'pre');

/** Every trace line from the SDK walk, the page's own and the shared flow helpers', appended to the trace area. */
setTraceSink((line) => {
  traceBox.append(`${line}\n`);
  traceBox.scrollTop = traceBox.scrollHeight;
});

/** Copies a text to the clipboard, saying so in the status line. */
export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  statusLine.textContent = 'Copied.';
}

/** A record as one line of JSON, bigints as decimal strings: the text a Copy button copies and the other page parses. */
export const line = (value: unknown): string =>
  JSON.stringify(value, (_key, entry: unknown) => (typeof entry === 'bigint' ? entry.toString() : entry));

/** Appends a titled JSON block, shown indented, with its own Copy button copying it as one line, to a box. */
export function copyableBlock(box: HTMLElement, title: string, value: unknown): void {
  const heading = document.createElement('h4');
  const body = document.createElement('pre');
  const copy = document.createElement('button');
  const text = show(value);

  heading.textContent = title;
  body.textContent = text;
  copy.type = 'button';
  copy.textContent = 'Copy';
  copy.addEventListener('click', () => {
    copyText(line(value)).catch((error: unknown) => {
      statusLine.textContent = `Copy failed: ${String(error)}`;
    });
  });
  box.append(heading, body, copy);
}

/** Appends one check line, a condition and what it means, to a box. */
export function checkLine(box: HTMLElement, holds: boolean, message: string): void {
  box.append(`${holds ? 'ok' : 'FAILED'}: ${message}\n`);
}
