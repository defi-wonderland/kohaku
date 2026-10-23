import {
  type ApproverRequest,
  type Gathering,
  type Hex,
  type IMethodsOrchestrator,
  type IRecoveryClient,
  METHOD_ECDSA_PROOF_FIELD,
  type Reply,
  type TypedData,
} from '@kohaku-eth/social-recovery';
import { isAddressEqual } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { note, step } from './trace';

/** The wallet guardian a request names, from the orchestrator's description; `undefined` for another method. */
export function namedGuardian(orchestrator: IMethodsOrchestrator, request: ApproverRequest): Hex | undefined {
  const { device } = orchestrator.describeRequest(request);
  const guardian = device === 'no-implementation' ? undefined : device['guardian'];

  return typeof guardian === 'string' ? (guardian as Hex) : undefined;
}

/**
 * One wallet guardian answering one request through the orchestrator: `signingInput` gives the typed data, the key
 * signs it, `replyFrom` turns the signature into the reply and `verify` gives the local verdict.
 */
async function answer(orchestrator: IMethodsOrchestrator, request: ApproverRequest, key: Hex): Promise<Reply> {
  const input = orchestrator.signingInput(request);
  const typedData = input as unknown as TypedData;
  const signer = privateKeyToAccount(key);
  const signature = await signer.signTypedData({
    domain: typedData.domain,
    types: typedData.types as Record<string, { name: string; type: string }[]>,
    primaryType: typedData.primaryType,
    message: { ...typedData.message, place: BigInt(typedData.message.place) },
  });
  const reply = await orchestrator.replyFrom(request, input, { [METHOD_ECDSA_PROOF_FIELD]: signature });

  if (reply.kind === 'reply-failure') throw new Error(`the orchestrator refused the signature: ${reply.cause}`);

  note(`place ${request.place} signed`, `${signer.address}, local verdict ${await orchestrator.verify(request, request.place, reply.proof)}`);

  return reply;
}

/**
 * Lets the first `threshold` guardians whose address a request names sign it, filing each reply into the gathering.
 * Throws where a reply is refused or fewer guardians than the threshold answered.
 */
export async function gatherReplies(
  client: IRecoveryClient,
  orchestrator: IMethodsOrchestrator,
  start: Gathering,
  guardianKeys: readonly Hex[],
  threshold: number,
): Promise<Gathering> {
  step('getApproverRequests');

  const requests = client.getApproverRequests(start);
  let gathering = start;
  let filed = 0;

  note('requests', requests.length);

  for (const request of requests) {
    if (filed === threshold) break;

    const signer = namedGuardian(orchestrator, request);
    const key = signer === undefined ? undefined : guardianKeys.find((candidate) => isAddressEqual(privateKeyToAccount(candidate).address, signer));

    if (key === undefined) continue;

    const result = client.addApproverReply(gathering, await answer(orchestrator, request, key));

    if (result.outcome === 'refused') throw new Error(`addApproverReply refused place ${request.place}: ${result.reason.cause}`);

    note(`addApproverReply place ${request.place}`, result.outcome);
    gathering = result.gathering;
    filed += 1;
  }

  if (filed < threshold) throw new Error(`only ${filed} of ${threshold} guardians could answer`);

  return gathering;
}
