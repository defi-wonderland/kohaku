import type { ApproverRequest, DeploymentDescriptor, IMethodsOrchestrator, RequestDescription } from '@kohaku-eth/social-recovery';
import { type Address, isAddressEqual } from 'viem';
import { note, show, step } from '../trace';
import { prefillAadhaarSeed } from './aadhaar';
import { approverOrchestrator, type MethodKind, methodKind } from './approver-deployment';
import { descriptionOut, valueOf } from './page';
import { prefillZkPassport } from './zkpassport';

/** The pasted request line, the JSON of the holder page's `ApproverRequest`. */
export function pastedRequest(): ApproverRequest {
  const text = valueOf('request-in');

  if (text === '') throw new Error('paste a request line from the holder page');

  return JSON.parse(text) as ApproverRequest;
}

/** What the approver reads before answering, in plain words. */
function summary(description: RequestDescription): string {
  const { handover, order } = description;
  const keys = handover === undefined
    ? ['a cancellation: no key changes']
    : handover.decoded
      ? [`new key ${handover.newAuthority}`, `removed key ${handover.removedAuthority}`]
      : [`the handover does not decode (${handover.cause})`];
  const paid = order === undefined ? 'no payment order' : `order ${order.amount} of ${order.token} to ${order.payee}`;

  return [
    `account ${description.account} (chain ${description.chainId}, manager ${description.manager})`,
    `${description.purpose} of attempt ${description.attemptId}, place ${description.place}`,
    ...keys,
    paid,
    `deadline ${new Date(description.validUntil * 1000).toISOString()} (validUntil ${description.validUntil})`,
    `method ${description.identityPublic.method}`,
  ].join('\n');
}

/**
 * Refuses a request made for another deployment than the approver's Deployment block: its chain id, its manager and
 * its action must be the form's, or the throw names the field, the request's value and the deployment's.
 */
function ensureSameDeployment(description: RequestDescription, descriptor: DeploymentDescriptor): void {
  if (Number(description.chainId) !== Number(descriptor.chainId)) {
    throw new Error(`the request is for chain ${description.chainId}, the deployment form is for chain ${descriptor.chainId}; not answered`);
  }

  const addresses: readonly [string, Address, Address][] = [
    ['manager', description.manager, descriptor.manager],
    ['action', description.action, descriptor.action],
  ];

  for (const [name, requested, deployed] of addresses) {
    if (!isAddressEqual(requested, deployed)) {
      throw new Error(`the request names ${name} ${requested}, the deployment form names ${name} ${deployed}; not answered`);
    }
  }
}

/** The pasted request, its description, the orchestrator over the form's descriptor and the request's method. */
export type DescribedRequest = {
  readonly request: ApproverRequest;
  readonly description: RequestDescription;
  readonly descriptor: DeploymentDescriptor;
  readonly orchestrator: IMethodsOrchestrator;
  readonly kind: MethodKind;
};

/**
 * The Describe step, also the first step of Sign: the orchestrator's description of the pasted request shown, the
 * method detected from `request.method`, and the fields its config fixes filled in (the zkPassport domain and scope,
 * the Aadhaar seed). A request for another chain, manager or action than the form's is refused before anything else
 * is asked; a module no implementation serves is the orchestrator's refusal, thrown here.
 */
export function describeRequest(): DescribedRequest {
  const request = pastedRequest();
  const { descriptor, orchestrator } = approverOrchestrator();

  step('describeRequest');

  const description = orchestrator.describeRequest(request);
  const kind = methodKind(descriptor, request.method);

  note('description', description);
  note('method', kind ?? 'not named by the deployment form');
  descriptionOut.textContent = `${summary(description)}\n\n${show(description)}`;
  ensureSameDeployment(description, descriptor);

  if (description.device === 'no-implementation' || kind === undefined) {
    orchestrator.signingInput(request);

    throw new Error(`no implementation serves the method ${request.method}`);
  }

  if (kind === 'zkpassport') prefillZkPassport(request.config);

  if (kind === 'aadhaar') prefillAadhaarSeed(request.config);

  return { request, description, descriptor, orchestrator, kind };
}
