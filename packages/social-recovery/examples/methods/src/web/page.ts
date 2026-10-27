import { element, traceInto } from './shared/dom';

export const connectButton = element<HTMLButtonElement>('#connect');
export const signButton = element<HTMLButtonElement>('#sign');
export const connectionLine = element<HTMLParagraphElement>('#connection');
export const verdictLine = element<HTMLParagraphElement>('#verdict');
export const traceBox = element<HTMLDivElement>('#trace');

/** A trace that appends each SDK call and its result to the page. */
export const pageTrace = traceInto(traceBox);
