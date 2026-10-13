import { show, type Trace } from '../format';

const element = <T extends HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);

  if (found === null) throw new Error(`missing element ${selector}`);

  return found;
};

export const connectButton = element<HTMLButtonElement>('#connect');
export const signButton = element<HTMLButtonElement>('#sign');
export const connectionLine = element<HTMLParagraphElement>('#connection');
export const verdictLine = element<HTMLParagraphElement>('#verdict');
export const traceBox = element<HTMLDivElement>('#trace');

/** A trace that appends each SDK call and its result to the page. */
export const pageTrace: Trace = (step, value) => {
  const heading = document.createElement('h3');

  heading.textContent = step;
  traceBox.append(heading);

  if (value === undefined) return;

  const body = document.createElement('pre');

  body.textContent = show(value);
  traceBox.append(body);
};
