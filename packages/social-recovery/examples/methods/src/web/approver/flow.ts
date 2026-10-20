import type { ApproverRequest, IMethodsOrchestrator } from '@kohaku-eth/social-recovery';
import { SAMPLE_CHAIN_ID } from '../../constants';
import { isFailure } from '../../format';
import { buildOrchestrator } from '../../orchestrator';
import { SAMPLE, sampleMethodOf, type SampleMethod } from '../../sample';
import { pageTrace, verdictLine } from '../page';
import { state } from '../session';
import { aadhaarOptions } from '../shared/aadhaar-core';
import { copyableLine, messageOf } from '../shared/dom';
import { credentialLine, parseRequest, replyLine } from '../shared/lines';
import { aadhaarPage, artifactsOrigin } from './aadhaar';
import { ui } from './page';
import { passkeyPage } from './passkey';
import type { ApproverMethod, Run } from './types';
import { walletPage } from './wallet';
import { zkPassportPage } from './zkpassport';

/** Each sample method's side of the page. */
export const PAGES: Readonly<Record<SampleMethod, ApproverMethod>> = {
  wallet: walletPage,
  passkey: passkeyPage,
  zkpassport: zkPassportPage,
  aadhaar: aadhaarPage,
};

/** The chain the page builds for: the connected wallet's, else the sample's. */
export const currentChainId = (): number => state.chainId ?? SAMPLE_CHAIN_ID;

let controller = new AbortController();

/** Aborts the running action's device step (the Aadhaar prover, the wait for the zkPassport app). */
export const abortRun = (): void => controller.abort();

/** A fresh run for the method: testing mode where the method has one and the switch is on, and a new abort signal. */
function runFor(method: SampleMethod): Run {
  controller = new AbortController();

  return { testing: PAGES[method].testingLabel !== undefined && ui.testing.checked, signal: controller.signal };
}

/** The orchestrator over the sample descriptor, the Aadhaar method on the stack the run's mode asks for. */
async function orchestratorFor(method: SampleMethod, run: Run): Promise<IMethodsOrchestrator> {
  const chainId = currentChainId();
  const aadhaar = method === 'aadhaar' ? await aadhaarOptions(run.testing, artifactsOrigin()) : {};
  const stack = method !== 'aadhaar' ? 'none' : run.testing ? 'the test-mode stack' : 'the default stack over the v2 files';

  pageTrace(
    `SocialRecoveryBuilder.from({ chainId: ${chainId}, descriptor: sample }).withMethod(zkPassportMethod()).withMethod(anonAadhaarMethod(${stack})).buildMethodsOrchestrator()`,
  );

  return buildOrchestrator(chainId, aadhaar);
}

/** Enrols with the picked method: `enrollInput`, the device's material, `configFrom`, and the credential line. */
export async function enrol(method: SampleMethod): Promise<void> {
  const run = runFor(method);
  const page = PAGES[method];
  const module = SAMPLE.methods[method];
  const orchestrator = await orchestratorFor(method, run);
  const input = orchestrator.enrollInput(module, await page.enrolParams(run));

  pageTrace(`orchestrator.enrollInput(${method} module, params)`, input);

  const step = await page.enrolMaterial(input, run);
  const config = await orchestrator.configFrom(module, input, step.material);

  step.checkpoint?.();
  pageTrace(`orchestrator.configFrom(${method} module, input, material)`, config);

  if (isFailure(config)) throw new Error(`enrolment refused: ${config.cause}`);

  ui.credentialBox.replaceChildren(copyableLine(credentialLine({ method: module, config }), 'Your credential line: paste it into the holder page'));
}

/** The orchestrator's refusal for a request whose module the sample does not hold, with where such a request is served. */
function unserved(orchestrator: IMethodsOrchestrator, request: ApproverRequest): Error {
  let refusal = 'the orchestrator holds no implementation for this module';

  try {
    orchestrator.signingInput(request);
  } catch (error) {
    refusal = messageOf(error);
  }

  pageTrace('orchestrator.signingInput(request) refuses', refusal);

  return new Error(
    `${refusal}. This playground serves its sample modules only; a request from a deployment belongs on the client-flows approver page.`,
  );
}

/** The pasted request, described by the orchestrator; picks the request's method in the picker when the sample serves it. */
export function describe(): { request: ApproverRequest; method: SampleMethod } {
  const request = parseRequest(ui.requestText.value);
  const orchestrator = buildOrchestrator(currentChainId());
  const description = orchestrator.describeRequest(request);
  const method = sampleMethodOf(request.method);

  ui.descriptionBox.textContent = JSON.stringify(description, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value), 2);
  pageTrace('orchestrator.describeRequest(request)', description);

  if (method === undefined) throw unserved(orchestrator, request);

  ui.methodPicker.value = method;
  ui.methodPicker.dispatchEvent(new Event('change'));

  return { request, method };
}

/** Signs the pasted request: `signingInput`, the device's material, `replyFrom`, the reply line, then `verify`. */
export async function sign(): Promise<void> {
  const { request, method } = describe();
  const run = runFor(method);
  const page = PAGES[method];
  const orchestrator = await orchestratorFor(method, run);
  const input = orchestrator.signingInput(request, await page.signParams(request, run));

  pageTrace('orchestrator.signingInput(request, params)', input);

  const step = await page.signMaterial(request, input, run);
  const reply = await orchestrator.replyFrom(request, input, step.material);

  step.checkpoint?.();
  pageTrace('orchestrator.replyFrom(request, input, material)', reply);

  if (isFailure(reply)) throw new Error(`reply refused: ${reply.cause}`);

  ui.replyBox.replaceChildren(copyableLine(replyLine(reply), 'Your reply line: paste it into the holder page'));

  const verdict = await orchestrator.verify(request, request.place, reply.proof);

  step.checkpoint?.();
  pageTrace('orchestrator.verify(request, request.place, reply.proof)', verdict);
  verdictLine.textContent = `Verdict: ${verdict}`;
}
