import { HttpRequestError } from 'viem';
import { WALLET_ANSWER_MS } from './chain';
import { endedSignal, LATE_MESSAGES, type Lifetime } from './lifetime';

/** The HTTP status of a rate-limited request. */
export const TOO_MANY_REQUESTS = 429;

/** The most bytes the page reads of one answer, the same bound viem keeps by default. */
export const MAX_ANSWER_BYTES = 10_485_760;

/** How a request is named in a timeout when its body names no JSON-RPC method. */
const UNNAMED_REQUEST = 'a request';

/** The refusal of an answer larger than `MAX_ANSWER_BYTES`. */
const TOO_LARGE_MESSAGE = `the read endpoint answered more than ${MAX_ANSWER_BYTES} bytes`;

let dispatching: Lifetime | undefined;

/**
 * Names the action whose read the page sends next to the Read RPC URL: the request's fetch starts within the same
 * turn of the event loop, and only one action runs at a time, so that action's end aborts the request.
 */
export const dispatchFor = (life: Lifetime): void => {
  dispatching = life;
};

/** The JSON-RPC method a request's body names. */
function methodOf(init: RequestInit | undefined): string {
  try {
    const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : '');

    return typeof body === 'object' && body !== null && 'method' in body && typeof body.method === 'string' ? body.method : UNNAMED_REQUEST;
  } catch {
    return UNNAMED_REQUEST;
  }
}

/** The whole body of `response`, read while `signal` lets it; an abort rejects the read with the signal's reason. */
async function bodyOf(response: Response, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body?.getReader();

  if (reader === undefined) return new Uint8Array(0);

  const stop = (): void => void reader.cancel(signal.reason).catch(() => undefined);

  signal.addEventListener('abort', stop, { once: true });

  try {
    for (;;) {
      signal.throwIfAborted();

      const { done, value } = await reader.read();

      signal.throwIfAborted();

      if (done) break;

      size += value.byteLength;

      if (size > MAX_ANSWER_BYTES) throw new Error(TOO_LARGE_MESSAGE);

      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', stop);
    stop();
  }

  const body = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

/**
 * The page's fetch for the Read RPC URL: the request, headers AND body, is aborted once `limitMs` passed, when viem's
 * own signal aborts, or when the action that sent it ends, so the read always settles. An HTTP 429 rejects as viem's
 * `HttpRequestError` with that status, whatever its body, before viem could read a JSON-RPC error out of it.
 */
export function endpointFetch(limitMs = WALLET_ANSWER_MS): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const method = methodOf(init);
    const limit = new AbortController();
    const timer = setTimeout(() => limit.abort(new Error(LATE_MESSAGES['read-endpoint'](method, limitMs / 1000))), limitMs);
    const owner = dispatching;
    const signals = [limit.signal, ...(init?.signal ? [init.signal] : []), ...(owner === undefined ? [] : [endedSignal(owner)])];
    const signal = AbortSignal.any(signals);

    try {
      signal.throwIfAborted();

      const response = await fetch(input, { ...init, signal });
      const body = await bodyOf(response, signal);

      if (response.status === TOO_MANY_REQUESTS) {
        const url = input instanceof Request ? input.url : String(input);
        const details = new TextDecoder().decode(body) || response.statusText;

        throw new HttpRequestError({ details, headers: response.headers, status: response.status, url });
      }

      const { status, statusText, headers } = response;

      return new Response(body.byteLength === 0 ? null : body, { status, statusText, headers });
    } finally {
      clearTimeout(timer);
    }
  };
}
