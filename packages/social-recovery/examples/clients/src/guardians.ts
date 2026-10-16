import {
  approvalDigest,
  approvalTypedData,
  type ApproverRequest,
  cancellationDigest,
  cancellationTypedData,
  type Ctx,
  type CancellationMembers,
  type Gathering,
  GATHERING_REPLY_KIND,
  GATHERING_REPLY_VERSION,
  type Hex,
  type IRecoveryClient,
  type IRecoveryMethod,
  METHOD_ECDSA_CONFIG_FIELD,
  METHOD_ECDSA_PROOF_FIELD,
  type Reply,
} from '@kohaku-eth/social-recovery';
import { isAddressEqual } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { note, step } from './trace';

// The approver side's ctx and reply for wallet guardians, built by hand in this one file; a methods orchestrator would build them instead.

/** The members a request's digest closes over, its decimal strings read back as numbers and bigints. */
function membersOf(request: ApproverRequest): CancellationMembers {
  return {
    chainId: Number(request.chainId),
    manager: request.manager,
    digestVersion: request.digestVersion,
    account: request.account,
    action: request.action,
    attemptId: BigInt(request.attemptId),
    setupNonce: BigInt(request.setupNonce),
    setupBodyHash: request.setupBodyHash,
    validUntil: Number(request.validUntil),
  };
}

/** The per-place ctx a method signs and verifies over: the request, its place, the digest and the typed data. */
export function ctxFor(request: ApproverRequest): Ctx {
  const members = membersOf(request);

  if (request.purpose === 'approval') {
    const approval = { ...members, payload: request.payload, order: { ...request.order, amount: BigInt(request.order.amount) } };

    return { request, place: request.place, digest: approvalDigest(approval, request.place), typedData: approvalTypedData(approval, request.place) };
  }

  return { request, place: request.place, digest: cancellationDigest(members, request.place), typedData: cancellationTypedData(members, request.place) };
}

/** The reply an approver sends back for one request and its proof. */
export function replyFor(ctx: Ctx, proof: Hex): Reply {
  const { request } = ctx;

  return {
    kind: GATHERING_REPLY_KIND,
    version: GATHERING_REPLY_VERSION,
    chainId: request.chainId,
    manager: request.manager,
    account: request.account,
    action: request.action,
    attemptId: request.attemptId,
    purpose: request.purpose,
    place: request.place,
    method: request.method,
    config: request.config,
    salt: request.salt,
    digest: ctx.digest,
    proof,
  };
}

/** One wallet guardian answering one request: the wallet signs the typed data, the method turns the signature into the proof. */
async function answer(method: IRecoveryMethod, request: ApproverRequest, key: Hex): Promise<Reply> {
  const ctx = ctxFor(request);
  const input = method.signingInput(ctx);
  const { typedData } = ctx;
  const signature = await privateKeyToAccount(key).signTypedData({
    domain: typedData.domain,
    types: typedData.types as Record<string, { name: string; type: string }[]>,
    primaryType: typedData.primaryType,
    message: { ...typedData.message, place: BigInt(typedData.message.place) },
  });
  const proof = await method.replyFrom(ctx, input, { [METHOD_ECDSA_PROOF_FIELD]: signature });

  if (typeof proof !== 'string') throw new Error(`the wallet method refused the signature: ${proof.cause}`);

  note(`place ${request.place} signed`, `${privateKeyToAccount(key).address}, local verdict ${await method.verify(ctx, proof)}`);

  return replyFor(ctx, proof);
}

/**
 * Lets the first `threshold` guardians whose address a request names sign it, filing each reply into the gathering.
 * Throws where a reply is refused or fewer guardians than the threshold answered.
 */
export async function gatherReplies(
  client: IRecoveryClient,
  method: IRecoveryMethod,
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

    const signer = method.codec.decodeConfig(request.config)[METHOD_ECDSA_CONFIG_FIELD] as Hex;
    const key = guardianKeys.find((candidate) => isAddressEqual(privateKeyToAccount(candidate).address, signer));

    if (key === undefined) continue;

    const result = client.addApproverReply(gathering, await answer(method, request, key));

    if (result.outcome === 'refused') throw new Error(`addApproverReply refused place ${request.place}: ${result.reason.cause}`);

    note(`addApproverReply place ${request.place}`, result.outcome);
    gathering = result.gathering;
    filed += 1;
  }

  if (filed < threshold) throw new Error(`only ${filed} of ${threshold} guardians could answer`);

  return gathering;
}
