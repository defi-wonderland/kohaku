import { show, type Trace } from '../../format';

/** The page element the selector names; a missing one is a page bug, so it throws. */
export const element = <T extends HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);

  if (found === null) throw new Error(`missing element ${selector}`);

  return found;
};

/** A trace that appends each SDK call and its result to the box. */
export const traceInto = (box: HTMLElement): Trace => (step, value) => {
  const heading = document.createElement('h3');

  heading.textContent = step;
  box.append(heading);

  if (value === undefined) return;

  const body = document.createElement('pre');

  body.textContent = show(value);
  box.append(body);
};

/** A line shown in a `<pre>` with a Copy button that writes it to the clipboard. */
export function copyableLine(line: string, title: string): HTMLElement {
  const wrapper = document.createElement('div');
  const label = document.createElement('p');
  const text = document.createElement('pre');
  const copy = document.createElement('button');

  label.textContent = title;
  text.textContent = line;
  copy.type = 'button';
  copy.textContent = 'Copy';
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(line).then(() => {
      copy.textContent = 'Copied';
    });
  });
  wrapper.append(label, text, copy);

  return wrapper;
}

/** The message of a thrown value. */
export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
