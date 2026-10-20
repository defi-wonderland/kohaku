import { METHOD_PASSKEY_OPTIONS_MEMBER, type ZkPassportRequest, type ZkPassportStackProof } from '@kohaku-eth/social-recovery';
import { note } from '../trace';
import { currentLifetime, endedSignal, ensureLive, type Lifetime } from './lifetime';
import { statusLine } from './page';

/** The controller of the device step running now; the Abort button ends it. */
let current: AbortController | undefined;

/** A fresh abort signal for the device step about to run. */
export function deviceSignal(): AbortSignal {
  current = new AbortController();

  return current.signal;
}

/** Ends the running device step: a zkPassport request, opening or pending, stops waiting and the Aadhaar prover answers `device-refused`. */
export function abortDevice(): void {
  current?.abort(new Error('aborted on the page'));
  note('abort requested');
}

/**
 * One device step as it started: the action's lifetime and the step's own abort signal, captured at its entry, and
 * `ended`, which aborts once the Abort button ends the step or that action ends or settles. A step's callbacks
 * consult `ended`, never the action current when they fire, so a late callback changes nothing on a later action.
 */
export type DeviceStep = { readonly life: Lifetime; readonly signal: AbortSignal; readonly ended: AbortSignal };

/** Starts a device step: a fresh abort signal for the Abort button, bound to the running action's lifetime. */
export function deviceStep(): DeviceStep {
  const life = currentLifetime();
  const signal = deviceSignal();

  return { life, signal, ended: AbortSignal.any([signal, endedSignal(life)]) };
}

/** Throws the reason a device step ended, so nothing more is asked, written or accepted for it. */
export function ensureStepLive(deviceRun: DeviceStep): void {
  ensureLive(deviceRun.life);

  if (deviceRun.ended.aborted) throw deviceRun.ended.reason;
}

/** `pending`, or the reason the device step ended first; the abort listener is removed once either settles. */
export function raced<T>(deviceRun: DeviceStep, pending: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const { ended } = deviceRun;
    const onEnded = (): void => reject(ended.reason);

    if (ended.aborted) {
      onEnded();
      pending.catch(() => undefined);

      return;
    }

    ended.addEventListener('abort', onEnded, { once: true });
    pending.then(
      (value) => {
        ended.removeEventListener('abort', onEnded);
        resolve(value);
      },
      (error: unknown) => {
        ended.removeEventListener('abort', onEnded);
        reject(error);
      },
    );
  });
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

/** What the zkPassport app sent back once every proof arrived, and the device step it arrived in. */
export type ZkPassportAnswer = {
  readonly proofs: ZkPassportStackProof[];
  readonly result: unknown;
  readonly opened: ZkPassportRequest;
  readonly deviceRun: DeviceStep;
};

/** Waits on an opened zkPassport request: the six callbacks traced while the step lives, settled once, then deaf. */
function awaitPhone(opened: ZkPassportRequest, deviceRun: DeviceStep): Promise<ZkPassportAnswer> {
  return new Promise((resolve, reject) => {
    const { ended } = deviceRun;
    let done = false;
    const live = (): boolean => !done && !ended.aborted;
    const finish = (settle: () => void): void => {
      if (done) return;

      done = true;
      ended.removeEventListener('abort', onEnded);
      settle();
    };
    const onEnded = (): void => finish(() => reject(ended.reason));
    const traced = (message: string) => (detail?: unknown): void => {
      if (live()) note(message, detail);
    };

    ended.addEventListener('abort', onEnded, { once: true });
    opened.onRequestReceived(traced('zkPassport onRequestReceived'));
    opened.onGeneratingProof(traced('zkPassport onGeneratingProof'));
    opened.onProofGenerated((proof) => traced('zkPassport onProofGenerated')(proof.name ?? 'a proof'));
    opened.onSuccess((response) => {
      if (!live()) return;

      note('zkPassport onSuccess', `${response.proofs.length} proof(s)`);
      finish(() => resolve({ proofs: response.proofs, result: response.result, opened, deviceRun }));
    });
    opened.onReject(() => {
      if (!live()) return;

      note('zkPassport onReject');
      finish(() => reject(new Error('the zkPassport request was rejected in the app')));
    });
    opened.onError((error) => {
      if (!live()) return;

      note('zkPassport onError', error);
      finish(() => reject(new Error(`zkPassport: ${error}`)));
    });
  });
}

/**
 * Opens the request a zkPassport input carries on the installed `@zkpassport/sdk`, shows its URL as a link to open
 * on the phone, traces the six callbacks and resolves on `onSuccess`; a rejection, an error, the Abort button or the
 * end of the action rejects at any moment, the opening included, and a step that ended publishes no link and accepts
 * no later answer. There is no QR code: no QR package is installed, so the link is shown as text.
 */
export async function zkPassportAnswer(input: Readonly<Record<string, unknown>>, link: HTMLAnchorElement): Promise<ZkPassportAnswer> {
  const deviceRun = deviceStep();

  ensureStepLive(deviceRun);

  const opened = await raced(deviceRun, (input['openRequest'] as () => Promise<ZkPassportRequest>)());

  ensureStepLive(deviceRun);
  link.href = opened.url;
  link.textContent = opened.url;
  note('zkPassport request', { requestId: opened.requestId, url: opened.url });
  statusLine.textContent = 'Open the zkPassport link on your phone (or scan it there) and follow the app…';

  return awaitPhone(opened, deviceRun);
}

/**
 * The enrollment's verified result, the shape the method's `configFrom` reads: the installed SDK's `verify` over the
 * proofs, the query the request was opened with and the scope, dev mode off; it races the answer's device step, so the
 * Abort button or the end of the action ends it too.
 */
export async function zkPassportVerified(answer: ZkPassportAnswer, domain: string, scope: string): Promise<Record<string, unknown>> {
  const { deviceRun } = answer;

  ensureStepLive(deviceRun);

  const { ZKPassport } = await raced(deviceRun, import('@zkpassport/sdk'));
  const query = (answer.opened as unknown as { readonly query: unknown }).query;
  const verifier = new ZKPassport(domain);
  const verification = await raced(deviceRun, verifier.verify({
    proofs: answer.proofs as Parameters<typeof verifier.verify>[0]['proofs'],
    originalQuery: query as Parameters<typeof verifier.verify>[0]['originalQuery'],
    queryResult: answer.result as Parameters<typeof verifier.verify>[0]['queryResult'],
    scope,
    devMode: false,
  }));

  ensureStepLive(deviceRun);
  note('zkPassport verify', { verified: verification.verified, uniqueIdentifier: verification.uniqueIdentifier });

  return { verified: verification.verified, uniqueIdentifier: verification.uniqueIdentifier, proofs: answer.proofs };
}
