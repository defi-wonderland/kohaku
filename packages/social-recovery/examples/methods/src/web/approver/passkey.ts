import { pageTrace } from '../page';
import { ui } from './page';
import { softwareAssertion, softwareCreation } from './passkey-authenticator';
import type { ApproverMethod } from './types';

/** The relying-party id: the page's host, so a passkey made on one host does not serve another. */
const relyingPartyId = (): string => globalThis.location?.hostname ?? 'localhost';

/** The WebAuthn options the orchestrator's input carries. */
const optionsOf = (input: Readonly<Record<string, unknown>>): unknown => input['options'];

/** The passkey method: a software P-256 authenticator in testing mode, the browser's authenticator in real mode. */
export const passkeyPage: ApproverMethod = {
  testingLabel: 'Testing mode: a software P-256 authenticator in this page, its key kept in localStorage (TEST ONLY)',
  realLabel: "Real mode: this browser's own authenticator through navigator.credentials, on this page's host",

  async enrolParams() {
    return { relyingPartyId: relyingPartyId(), userName: ui.passkeyUser.value.trim() || 'playground guardian' };
  },

  async enrolMaterial(input, run) {
    const options = optionsOf(input);

    if (run.testing) {
      const credential = softwareCreation(options, relyingPartyId());

      pageTrace('the software authenticator: what navigator.credentials.create returns', credential);

      return { material: { credential } };
    }

    const credential = await navigator.credentials.create(options as CredentialCreationOptions);

    pageTrace('navigator.credentials.create(input.options)', credential === null ? null : 'a PublicKeyCredential');

    return { material: { credential } };
  },

  async signParams() {
    return { relyingPartyId: relyingPartyId() };
  },

  async signMaterial(_request, input, run) {
    const options = optionsOf(input);

    if (run.testing) {
      const assertion = softwareAssertion(options, relyingPartyId());

      pageTrace('the software authenticator: what navigator.credentials.get returns', assertion);

      return { material: { assertion } };
    }

    const assertion = await navigator.credentials.get(options as CredentialRequestOptions);

    pageTrace('navigator.credentials.get(input.options)', assertion === null ? null : 'a PublicKeyCredential');

    return { material: { assertion } };
  },
};
