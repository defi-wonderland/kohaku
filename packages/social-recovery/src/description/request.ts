import {
  DESCRIPTION_OPEN_PAYEE,
  DESCRIPTION_ROUND_TRIP_FAILED,
  DESCRIPTION_UNREAD_PURPOSE_MESSAGE,
  DESCRIPTION_UNREAD_REQUEST_MESSAGE,
  FORMATS_AMOUNT_BITS,
  FORMATS_ATTEMPT_ID_BITS,
  FORMATS_CHAIN_ID_BITS,
  FORMATS_PLACE_BITS,
  FORMATS_SETUP_NONCE_BITS,
  FORMATS_VALID_UNTIL_BITS,
  GATHERING_REQUEST_KIND,
  GATHERING_REQUEST_VERSION,
} from '../constants';
import { approvalDigest, approvalTypedData, cancellationDigest, cancellationTypedData } from '../formats/digests';
import { assertBytes, assertBytes32, assertObject, assertUintNumber, normalizeAddress } from '../formats/guards';
import { decimalBigint, decimalNumber } from '../gathering/edge';
import type {
  ApproverRequest,
  Ctx,
  DescribedHandover,
  DescribedOrder,
  Hex,
  IActionCodec,
  PaymentOrder,
  RequestDescription,
} from '../interfaces';
import type { ActionCodecRegistry, CancellationMembers, MethodRegistry } from '../types';
import { entryFor } from './lookup';

/** The members a digest closes over, converted from the request's decimal strings, addresses checksummed. */
function membersOf(request: ApproverRequest): CancellationMembers {
  assertBytes32(request.setupBodyHash, 'request.setupBodyHash');

  return {
    chainId: decimalNumber(request.chainId, FORMATS_CHAIN_ID_BITS, 'request.chainId'),
    manager: normalizeAddress(request.manager, 'request.manager'),
    account: normalizeAddress(request.account, 'request.account'),
    action: normalizeAddress(request.action, 'request.action'),
    attemptId: decimalBigint(request.attemptId, FORMATS_ATTEMPT_ID_BITS, 'request.attemptId'),
    setupNonce: decimalBigint(request.setupNonce, FORMATS_SETUP_NONCE_BITS, 'request.setupNonce'),
    setupBodyHash: request.setupBodyHash,
    validUntil: decimalNumber(request.validUntil, FORMATS_VALID_UNTIL_BITS, 'request.validUntil'),
    digestVersion: request.digestVersion,
  };
}

/** The opening request's order with its amount as a bigint and its addresses checksummed. */
function orderOf(request: Extract<ApproverRequest, { readonly purpose: 'approval' }>): PaymentOrder {
  assertObject(request.order, 'request.order');

  return {
    token: normalizeAddress(request.order.token, 'request.order.token'),
    amount: decimalBigint(request.order.amount, FORMATS_AMOUNT_BITS, 'request.order.amount'),
    payee: normalizeAddress(request.order.payee, 'request.order.payee'),
  };
}

/** The handover the codec decodes, kept only where encoding it again gives back the payload's own bytes. */
function describedHandover(payload: Hex, codec: IActionCodec | undefined): DescribedHandover {
  if (codec === undefined) return { decoded: false, cause: 'no-codec' };

  try {
    const handover = codec.decode(payload);

    if (handover.removedAuthority === undefined) return DESCRIPTION_ROUND_TRIP_FAILED;

    if (codec.encode(handover).toLowerCase() !== payload.toLowerCase()) return DESCRIPTION_ROUND_TRIP_FAILED;

    return {
      decoded: true,
      newAuthority: normalizeAddress(handover.newAuthority, 'handover.newAuthority'),
      removedAuthority: normalizeAddress(handover.removedAuthority, 'handover.removedAuthority'),
    };
  } catch {
    return DESCRIPTION_ROUND_TRIP_FAILED;
  }
}

const describedOrder = (order: PaymentOrder): DescribedOrder => ({
  token: order.token,
  amount: order.amount,
  payee: order.payee.toLowerCase() === DESCRIPTION_OPEN_PAYEE ? 'open' : order.payee,
});

/** The per-place record a method implementation's `describe` reads. */
function ctxOf(request: ApproverRequest, members: CancellationMembers, order: PaymentOrder | undefined): Ctx {
  const { place } = request;

  if (request.purpose === 'cancellation' || order === undefined) {
    return { request, place, digest: cancellationDigest(members, place), typedData: cancellationTypedData(members, place) };
  }

  const approval = { ...members, payload: request.payload, order };

  return { request, place, digest: approvalDigest(approval, place), typedData: approvalTypedData(approval, place) };
}

/**
 * What an approver reads before producing a proof, from the request and the two registries with no chain read.
 * Throws a TypeError or RangeError on a request this build does not read or whose members are malformed.
 */
export function describeRequest(
  request: ApproverRequest,
  codecs: ActionCodecRegistry,
  methods: MethodRegistry,
): RequestDescription {
  assertObject(request, 'request');

  if (request.kind !== GATHERING_REQUEST_KIND || request.version !== GATHERING_REQUEST_VERSION) {
    throw new TypeError(DESCRIPTION_UNREAD_REQUEST_MESSAGE);
  }

  if (request.purpose !== 'approval' && request.purpose !== 'cancellation') {
    throw new TypeError(DESCRIPTION_UNREAD_PURPOSE_MESSAGE);
  }

  assertUintNumber(request.place, FORMATS_PLACE_BITS, 'request.place');
  assertBytes(request.config, 'request.config');

  const members = membersOf(request);
  const method = normalizeAddress(request.method, 'request.method');
  const order = request.purpose === 'approval' ? orderOf(request) : undefined;
  const implementation = entryFor(methods, method);
  const ctx = ctxOf(request, members, order);
  const shared = {
    account: members.account,
    chainId: members.chainId,
    manager: members.manager,
    action: members.action,
    attemptId: members.attemptId,
    setupNonce: members.setupNonce,
    purpose: request.purpose,
    validUntil: members.validUntil,
    place: request.place,
    identityPublic: { method, config: request.config.toLowerCase() as Hex, saltPublished: true },
    device: implementation === undefined ? 'no-implementation' : implementation.describe(ctx),
  } as const;

  if (request.purpose === 'cancellation' || order === undefined) return shared;

  return {
    ...shared,
    handover: describedHandover(request.payload, entryFor(codecs, members.action)),
    order: describedOrder(order),
  };
}
