import { FORMATS_ATTEMPT_ID_BITS, FORMATS_CHAIN_ID_BITS, FORMATS_SETUP_NONCE_BITS, GATHERING_KIND, GATHERING_VERSION } from '../constants';
import { decodeSetupBody } from '../formats/setup-body';
import { assertObject, normalizeAddress } from '../formats/guards';
import type { Gathering, GatheringPlace } from '../interfaces';
import type { GatheringMembers } from '../types';
import { clausePlaces, decimalBigint, decimalNumber, windowFactsOf } from './edge';

/** The request block with its addresses checksummed and every nested value copied. */
function copiedRequest(members: GatheringMembers): GatheringMembers {
  const copy = structuredClone(members);
  const addresses = {
    manager: normalizeAddress(copy.request.manager, 'manager'),
    account: normalizeAddress(copy.request.account, 'account'),
    action: normalizeAddress(copy.request.action, 'action'),
  };

  if (copy.purpose === 'cancellation') {
    return { purpose: copy.purpose, request: { ...copy.request, ...addresses } };
  }

  const order = {
    ...copy.request.order,
    token: normalizeAddress(copy.request.order.token, 'order.token'),
    payee: normalizeAddress(copy.request.order.payee, 'order.payee'),
  };

  return { purpose: copy.purpose, request: { ...copy.request, ...addresses, order } };
}

/**
 * The record a gathering starts from, with no replies and the version this build writes.
 * Throws on a malformed member and where the place map does not number the body's credentials in order.
 */
export function seed(members: GatheringMembers, places: readonly GatheringPlace[]): Gathering {
  assertObject(members, 'members');
  assertObject(members.request, 'members.request');

  const { request, purpose } = copiedRequest(members);
  const record = { kind: GATHERING_KIND, version: GATHERING_VERSION, purpose, request, places: [], replies: [] } as Gathering;
  const total = clausePlaces(decodeSetupBody(request.setupBody)).flatMap((clause) => clause.places).length;

  decimalNumber(request.chainId, FORMATS_CHAIN_ID_BITS, 'chainId');
  decimalBigint(request.attemptId, FORMATS_ATTEMPT_ID_BITS, 'attemptId');
  decimalBigint(request.setupNonce, FORMATS_SETUP_NONCE_BITS, 'setupNonce');
  windowFactsOf(record);

  if (!Array.isArray(places) || places.length !== total || places.some((entry, index) => entry?.place !== index)) {
    throw new RangeError(`the place map must number the body's ${total} credentials in order`);
  }

  return { ...record, places: structuredClone(places) };
}
