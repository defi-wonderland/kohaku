import type { ApproverRequest, Credential, Reply } from '@kohaku-eth/social-recovery';

/** The JSON object a line holds, or a thrown error naming what the line was meant to be. */
const objectOf = (line: string, what: string): Readonly<Record<string, unknown>> => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error(`not a ${what} line: not JSON`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(`not a ${what} line: not a JSON object`);

  return parsed as Readonly<Record<string, unknown>>;
};

/** One credential as its line: the SDK's `Credential` record as JSON. */
export const credentialLine = (credential: Credential): string => JSON.stringify(credential);

/** The credentials of a pasted text, one `Credential` per non-empty line, in place order. */
export function parseCredentialLines(text: string): Credential[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line, place) => {
      const credential = objectOf(line, 'credential');

      if (typeof credential['method'] !== 'string' || typeof credential['config'] !== 'string') {
        throw new Error(`credential line ${place + 1} carries no method or config string`);
      }

      return credential as Credential;
    });
}

/** One approver request as its line: the `ApproverRequest` the gathering produced, as JSON. */
export const requestLine = (request: ApproverRequest): string => JSON.stringify(request);

/** The approver request a pasted line holds; the orchestrator checks its members. */
export const parseRequest = (line: string): ApproverRequest => objectOf(line.trim(), 'request') as unknown as ApproverRequest;

/** One reply as its line: the SDK's `Reply` record as JSON. */
export const replyLine = (reply: Reply): string => JSON.stringify(reply);

/** The reply a pasted line holds; `fileReply` checks it against the record. */
export const parseReply = (line: string): Reply => objectOf(line.trim(), 'reply') as unknown as Reply;
