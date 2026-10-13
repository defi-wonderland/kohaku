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

export const connectionLine = element<HTMLParagraphElement>('#connection');
export const statusLine = element<HTMLParagraphElement>('#status');
export const accountLine = element<HTMLParagraphElement>('#account-line');
export const stateOut = element<HTMLPreElement>('#state-out');
export const requestsBox = element<HTMLDivElement>('#requests');
export const executeOut = element<HTMLPreElement>('#execute-out');
export const replyOut = element<HTMLPreElement>('#reply-out');
export const traceBox = element<HTMLPreElement>('#trace');

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

/** Appends a titled JSON block with its own Copy button to a box. */
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
    copyText(text).catch((error: unknown) => {
      statusLine.textContent = `Copy failed: ${String(error)}`;
    });
  });
  box.append(heading, body, copy);
}

/** Appends one check line, a condition and what it means, to a box. */
export function checkLine(box: HTMLElement, holds: boolean, message: string): void {
  box.append(`${holds ? 'ok' : 'FAILED'}: ${message}\n`);
}
