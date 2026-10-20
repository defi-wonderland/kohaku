import { METHOD_PASSKEY_OPTIONS_MEMBER, type ZkPassportRequest, type ZkPassportStackProof } from '@kohaku-eth/social-recovery';
import { note } from '../trace';
import { ensureLive } from './lifetime';
import { statusLine } from './page';

/** The controller of the device step running now; the Abort button ends it. */
let current: AbortController | undefined;

/** A fresh abort signal for the device step about to run. */
export function deviceSignal(): AbortSignal {
  current = new AbortController();

  return current.signal;
}

/** Ends the running device step: a pending zkPassport request stops waiting and the Aadhaar prover answers `device-refused`. */
export function abortDevice(): void {
  current?.abort(new Error('aborted on the page'));
  note('abort requested');
}

/** The browser's passkey assertion over the options a signing input carries; the authenticator's own prompt asks the person. */
export async function passkeyAssertion(input: Readonly<Record<string, unknown>>): Promise<Credential | null> {
  statusLine.textContent = 'Confirm with your passkey…';
  note('navigator.credentials.get', { rpId: input['relyingPartyId'] });

  const assertion = await navigator.credentials.get(input[METHOD_PASSKEY_OPTIONS_MEMBER] as CredentialRequestOptions);

  ensureLive();

  return assertion;
}

/** A new passkey created over the options an enrollment input carries. */
export async function passkeyCreation(input: Readonly<Record<string, unknown>>): Promise<Credential | null> {
  statusLine.textContent = 'Create the passkey in your browser or authenticator…';
  note('navigator.credentials.create', { rpId: input['relyingPartyId'], userName: input['userName'] });

  const credential = await navigator.credentials.create(input[METHOD_PASSKEY_OPTIONS_MEMBER] as CredentialCreationOptions);

  ensureLive();

  return credential;
}

/** What the zkPassport app sent back once every proof arrived. */
export type ZkPassportAnswer = { readonly proofs: ZkPassportStackProof[]; readonly result: unknown; readonly opened: ZkPassportRequest };

/**
 * Opens the request a zkPassport input carries on the installed `@zkpassport/sdk`, shows its URL as a link to open
 * on the phone, traces the six callbacks and resolves on `onSuccess`; a rejection, an error or the Abort button
 * rejects. There is no QR code: no QR package is installed, so the link is shown as text.
 */
export async function zkPassportAnswer(input: Readonly<Record<string, unknown>>, link: HTMLAnchorElement): Promise<ZkPassportAnswer> {
  const signal = deviceSignal();
  const opened = await (input['openRequest'] as () => Promise<ZkPassportRequest>)();

  ensureLive();
  link.href = opened.url;
  link.textContent = opened.url;
  note('zkPassport request', { requestId: opened.requestId, url: opened.url });
  statusLine.textContent = 'Open the zkPassport link on your phone (or scan it there) and follow the app…';

  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    opened.onRequestReceived(() => note('zkPassport onRequestReceived'));
    opened.onGeneratingProof(() => note('zkPassport onGeneratingProof'));
    opened.onProofGenerated((proof) => note('zkPassport onProofGenerated', proof.name ?? 'a proof'));
    opened.onSuccess((response) => {
      note('zkPassport onSuccess', `${response.proofs.length} proof(s)`);
      resolve({ proofs: response.proofs, result: response.result, opened });
    });
    opened.onReject(() => {
      note('zkPassport onReject');
      reject(new Error('the zkPassport request was rejected in the app'));
    });
    opened.onError((error) => {
      note('zkPassport onError', error);
      reject(new Error(`zkPassport: ${error}`));
    });
  });
}

/**
 * The enrollment's verified result, the shape the method's `configFrom` reads: the installed SDK's `verify` over the
 * proofs, the query the request was opened with and the scope, dev mode off.
 */
export async function zkPassportVerified(answer: ZkPassportAnswer, domain: string, scope: string): Promise<Record<string, unknown>> {
  const { ZKPassport } = await import('@zkpassport/sdk');
  const query = (answer.opened as unknown as { readonly query: unknown }).query;
  const verifier = new ZKPassport(domain);
  const verification = await verifier.verify({
    proofs: answer.proofs as Parameters<typeof verifier.verify>[0]['proofs'],
    originalQuery: query as Parameters<typeof verifier.verify>[0]['originalQuery'],
    queryResult: answer.result as Parameters<typeof verifier.verify>[0]['queryResult'],
    scope,
    devMode: false,
  });

  ensureLive();
  note('zkPassport verify', { verified: verification.verified, uniqueIdentifier: verification.uniqueIdentifier });

  return { verified: verification.verified, uniqueIdentifier: verification.uniqueIdentifier, proofs: answer.proofs };
}
