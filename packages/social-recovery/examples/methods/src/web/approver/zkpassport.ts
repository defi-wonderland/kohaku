import type { Input, ZkPassportRequest, ZkPassportStackProof } from '@kohaku-eth/social-recovery';
import { pageTrace } from '../page';
import { ui } from './page';
import type { ApproverMethod } from './types';

/** What the zkPassport app hands back once every proof arrived. */
type Outcome = { readonly proofs: ZkPassportStackProof[]; readonly result: unknown };

/** The scope the playground's credentials are scoped to when the field is left empty. */
const DEFAULT_SCOPE = 'social-recovery-playground';

/** The session parameters: the service domain (this page's host by default), the scope, and what the phone shows. */
const sessionParams = (purpose: string) => ({
  domain: ui.zkDomain.value.trim() || (globalThis.location?.hostname ?? 'localhost'),
  scope: ui.zkScope.value.trim() || DEFAULT_SCOPE,
  name: 'Social recovery playground',
  purpose,
});

/** Shows the request URL as a link and as text, for the zkPassport app on a phone. */
function showRequest(url: string): void {
  const link = document.createElement('a');
  const text = document.createElement('pre');

  link.href = url;
  link.textContent = 'Open this request in the zkPassport app (or open the URL below on the phone)';
  link.target = '_blank';
  link.rel = 'noopener';
  text.textContent = url;
  ui.appLink.replaceChildren(link, text);
}

/** Opens the input's request on the installed stack, traces its six callbacks and settles on success, rejection, error or Abort. */
async function outcomeOf(input: Input, signal: AbortSignal): Promise<{ request: ZkPassportRequest; outcome: Outcome }> {
  const request = await (input['openRequest'] as () => Promise<ZkPassportRequest>)();

  pageTrace('input.openRequest(): the request the zkPassport app opens', { url: request.url, requestId: request.requestId });
  showRequest(request.url);

  const outcome = await new Promise<Outcome>((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted on this page')), { once: true });
    request.onRequestReceived(() => pageTrace('onRequestReceived: the app opened the request'));
    request.onGeneratingProof(() => pageTrace('onGeneratingProof: the app is proving'));
    request.onProofGenerated((proof) => pageTrace('onProofGenerated', proof.name));
    request.onSuccess((response) => {
      pageTrace('onSuccess: every proof arrived', response.proofs.map((proof) => proof.name));
      resolve(response);
    });
    request.onReject(() => {
      pageTrace('onReject');
      reject(new Error('the request was rejected in the zkPassport app'));
    });
    request.onError((error) => {
      pageTrace('onError', error);
      reject(new Error(`zkPassport: ${error}`));
    });
  });

  return { request, outcome };
}

/** The zkPassport method, real documents only: the installed `@zkpassport/sdk` and the zkPassport app on a phone. */
export const zkPassportPage: ApproverMethod = {
  testingLabel: undefined,
  realLabel: 'Real documents only (no testing mode yet): the installed @zkpassport/sdk and the zkPassport app with a real passport or ID card',

  async enrolParams() {
    return sessionParams('Enrol your document as a recovery guardian');
  },

  async enrolMaterial(input, run) {
    const { request, outcome } = await outcomeOf(input, run.signal);
    const { ZKPassport } = await import('@zkpassport/sdk');
    const session = sessionParams('');
    const verification = await new ZKPassport(session.domain).verify({
      proofs: outcome.proofs as never,
      originalQuery: (request as unknown as { query: never }).query,
      queryResult: outcome.result as never,
      scope: session.scope,
      devMode: false,
    });

    pageTrace('new ZKPassport(domain).verify({ proofs, originalQuery, queryResult, scope, devMode: false })', verification);

    return { material: { result: { verified: verification.verified, uniqueIdentifier: verification.uniqueIdentifier, proofs: outcome.proofs } } };
  },

  async signParams() {
    return sessionParams('Approve a recovery of the account you guard');
  },

  async signMaterial(_request, input, run) {
    const { outcome } = await outcomeOf(input, run.signal);

    return { material: { proofs: outcome.proofs } };
  },
};
