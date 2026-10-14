import {
  DESCRIPTION_UNREAD_PURPOSE_MESSAGE,
  DESCRIPTION_UNREAD_REQUEST_MESSAGE,
  FORMATS_AMOUNT_BITS,
  FORMATS_ATTEMPT_ID_BITS,
  FORMATS_CHAIN_ID_BITS,
  FORMATS_PLACE_BITS,
  FORMATS_SAFE_INTEGER_BITS,
  FORMATS_SETUP_NONCE_BITS,
  FORMATS_VALID_UNTIL_BITS,
  GATHERING_REQUEST_KIND,
  GATHERING_REQUEST_VERSION,
} from '../constants';
import { approvalDigest, approvalTypedData, cancellationDigest, cancellationTypedData } from '../formats/digests';
import { assertBool, assertBytes, assertBytes32, assertObject, assertUintNumber, lowerHex, normalizeAddress } from '../formats/guards';
import { decimalBigint, decimalNumber } from '../gathering/edge';
import { PURPOSES, type ApproverRequest, type Ctx, type Hex, type PaymentOrder } from '../interfaces';
import type { CancellationMembers } from '../types';
import type { CheckedRequest } from '../types/methods-orchestrator';

/** Whether the request's kind, version and purpose are the ones this build reads. */
export function isRequestRead(request: object): boolean {
  const { kind, version, purpose } = request as Partial<Record<'kind' | 'version' | 'purpose', unknown>>;

  return kind === GATHERING_REQUEST_KIND && version === GATHERING_REQUEST_VERSION && (PURPOSES as readonly unknown[]).includes(purpose);
}

/** The members a digest closes over, converted from the request's decimal strings, addresses checksummed. */
function membersOf(request: ApproverRequest): CancellationMembers {
  const setupBodyHash = request.setupBodyHash;

  assertBytes32(setupBodyHash, 'request.setupBodyHash');

  return {
    chainId: decimalNumber(request.chainId, FORMATS_CHAIN_ID_BITS, 'request.chainId'),
    manager: normalizeAddress(request.manager, 'request.manager'),
    account: normalizeAddress(request.account, 'request.account'),
    action: normalizeAddress(request.action, 'request.action'),
    attemptId: decimalBigint(request.attemptId, FORMATS_ATTEMPT_ID_BITS, 'request.attemptId'),
    setupNonce: decimalBigint(request.setupNonce, FORMATS_SETUP_NONCE_BITS, 'request.setupNonce'),
    setupBodyHash: lowerHex(setupBodyHash),
    validUntil: decimalNumber(request.validUntil, FORMATS_VALID_UNTIL_BITS, 'request.validUntil'),
    digestVersion: decimalBigint(request.digestVersion, FORMATS_SAFE_INTEGER_BITS, 'request.digestVersion').toString(),
  };
}

/** The opening request's order with its amount as a bigint and its addresses checksummed. */
function orderOf(request: Extract<ApproverRequest, { readonly purpose: 'approval' }>): PaymentOrder {
  const order: unknown = request.order;

  assertObject(order, 'request.order');

  const { token, amount, payee } = order as Partial<Record<keyof PaymentOrder, unknown>>;

  return {
    token: normalizeAddress(token, 'request.order.token'),
    amount: decimalBigint(amount, FORMATS_AMOUNT_BITS, 'request.order.amount'),
    payee: normalizeAddress(payee, 'request.order.payee'),
  };
}

/**
 * A frozen copy naming every request field: addresses checksummed, hex lower-cased, decimals canonical.
 * Built from values already checked, so nothing the caller added or can still change reaches an implementation.
 */
function frozenRequest(
  members: CancellationMembers,
  own: Pick<ApproverRequest, 'place' | 'method' | 'config' | 'salt' | 'credentialHoldsCode'>,
  order: PaymentOrder | undefined,
  payload: Hex | undefined,
): ApproverRequest {
  const shared = {
    kind: GATHERING_REQUEST_KIND,
    version: GATHERING_REQUEST_VERSION,
    chainId: members.chainId.toString(),
    manager: members.manager,
    digestVersion: members.digestVersion ?? '',
    account: members.account,
    action: members.action,
    attemptId: members.attemptId.toString(),
    setupNonce: members.setupNonce.toString(),
    setupBodyHash: members.setupBodyHash,
    validUntil: members.validUntil.toString(),
    place: own.place,
    method: own.method,
    config: lowerHex(own.config),
    salt: lowerHex(own.salt),
    credentialHoldsCode: own.credentialHoldsCode,
  } as const;

  if (order === undefined || payload === undefined) return Object.freeze({ ...shared, purpose: 'cancellation' });

  const copiedOrder = Object.freeze({ token: order.token, amount: order.amount.toString(), payee: order.payee });

  return Object.freeze({ ...shared, purpose: 'approval', payload: lowerHex(payload), order: copiedOrder });
}

/** The per-place record a method implementation reads, its digest and typed data derived from the copy's members. */
function ctxOf(request: ApproverRequest, members: CancellationMembers, order: PaymentOrder | undefined): Ctx {
  const { place } = request;

  if (request.purpose === 'cancellation' || order === undefined) {
    return Object.freeze({ request, place, digest: cancellationDigest(members, place), typedData: cancellationTypedData(members, place) });
  }

  const approval = { ...members, payload: request.payload, order };

  return Object.freeze({ request, place, digest: approvalDigest(approval, place), typedData: approvalTypedData(approval, place) });
}

/**
 * The request checked whole and the ctx built from it alone, with no chain read.
 * Throws a TypeError or RangeError on a request this build does not read or whose members are malformed.
 */
export function checkedRequest(request: ApproverRequest): CheckedRequest {
  assertObject(request, 'request');

  if (request.kind !== GATHERING_REQUEST_KIND || request.version !== GATHERING_REQUEST_VERSION) {
    throw new TypeError(DESCRIPTION_UNREAD_REQUEST_MESSAGE);
  }

  const purpose: unknown = request.purpose;

  if (purpose !== 'approval' && purpose !== 'cancellation') {
    throw new TypeError(DESCRIPTION_UNREAD_PURPOSE_MESSAGE);
  }

  const { place, config, salt, credentialHoldsCode } = request;

  assertUintNumber(place, FORMATS_PLACE_BITS, 'request.place');
  assertBytes(config, 'request.config');
  assertBytes32(salt, 'request.salt');
  assertBool(credentialHoldsCode, 'request.credentialHoldsCode');

  const members = membersOf(request);
  const method = normalizeAddress(request.method, 'request.method');
  const opening = purpose === 'approval' ? (request as Extract<ApproverRequest, { readonly purpose: 'approval' }>) : undefined;
  const order = opening === undefined ? undefined : orderOf(opening);
  const payload: unknown = opening?.payload;

  if (opening !== undefined) assertBytes(payload, 'payload');

  const copy = frozenRequest(members, { place, method, config, salt, credentialHoldsCode }, order, payload as Hex | undefined);

  return { ctx: ctxOf(copy, members, order), members, order };
}
