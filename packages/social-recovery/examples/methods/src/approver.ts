import {
  approvalDigest,
  approvalTypedData,
  cancellationDigest,
  cancellationTypedData,
  GATHERING_REPLY_KIND,
  GATHERING_REPLY_VERSION,
  type ApproverRequest,
  type CancellationMembers,
  type Ctx,
  type Hex,
  type Reply,
} from '@kohaku-eth/social-recovery';

/** The members the digest closes over, read back from the request's decimal strings. */
function membersOf(request: ApproverRequest): CancellationMembers {
  return {
    chainId: Number(request.chainId),
    manager: request.manager,
    account: request.account,
    action: request.action,
    attemptId: BigInt(request.attemptId),
    setupNonce: BigInt(request.setupNonce),
    setupBodyHash: request.setupBodyHash,
    validUntil: Number(request.validUntil),
    digestVersion: request.digestVersion,
  };
}

/**
 * The per-place context a method reads, built from one approver request with the SDK's public digest builders.
 * Stands in for `MethodsOrchestrator`, which builds the ctx itself and replaces this helper once the SDK ships it.
 */
export function ctxFor(request: ApproverRequest): Ctx {
  const members = membersOf(request);
  const { place } = request;

  if (request.purpose === 'cancellation') {
    return { request, place, digest: cancellationDigest(members, place), typedData: cancellationTypedData(members, place) };
  }

  const order = { token: request.order.token, amount: BigInt(request.order.amount), payee: request.order.payee };
  const approval = { ...members, payload: request.payload, order };

  return { request, place, digest: approvalDigest(approval, place), typedData: approvalTypedData(approval, place) };
}

/**
 * The reply an approver sends back: the request's binding, its own credential, the digest it signed and the method's proof.
 * Stands in for `MethodsOrchestrator`, which packages the reply itself and replaces this helper once the SDK ships it.
 */
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
