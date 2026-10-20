import { element, traceInto } from '../shared/dom';

/** The holder page's elements. */
export const ui = {
  chainId: element<HTMLInputElement>('#chain-id'),
  credentials: element<HTMLTextAreaElement>('#credentials'),
  readButton: element<HTMLButtonElement>('#read'),
  places: element<HTMLDivElement>('#places'),
  threshold: element<HTMLInputElement>('#threshold'),
  wait: element<HTMLInputElement>('#wait'),
  gatherButton: element<HTMLButtonElement>('#gather'),
  requestsBox: element<HTMLDivElement>('#requests'),
  replyText: element<HTMLTextAreaElement>('#reply'),
  fileButton: element<HTMLButtonElement>('#file'),
  aadhaarTest: element<HTMLInputElement>('#aadhaar-test'),
  status: element<HTMLParagraphElement>('#status'),
  traceBox: element<HTMLDivElement>('#trace'),
};

/** A trace that appends each SDK call and its result to the page. */
export const holderTrace = traceInto(ui.traceBox);
