import { FORMATS_SAFE_INTEGER_BITS, RECOVERY_CLIENT_PAYLOAD_MALFORMED_MESSAGE, RECOVERY_CLIENT_VERSION_ESCAPED_MESSAGE } from '../constants';
import { KitRefusalError } from '../client-core';
import { assertUintNumber } from '../formats/guards';
import { sortedProofPlaces } from '../formats/proof-place';
import type { AttemptRequest, CancelRequest, Hex, Moment } from '../interfaces';
import { assertBoundRequest } from '../policy-manager/calldata';
import type { RecoveryClientParts } from '../types/recovery-client';
import { checkedRequest } from '../validation/request-parse';

/** Refuses every prepare of a client built for a deployment version this build does not serve. */
export function assertPreparesServed(versionEscaped: boolean): void {
  if (versionEscaped) throw new KitRefusalError(RECOVERY_CLIENT_VERSION_ESCAPED_MESSAGE);
}

/**
 * Refuses with a `TypeError` or `RangeError` a submission whose members are not the shapes its record declares, an opening
 * passed where a cancellation is expected or the reverse, proofs repeating a place (the encoder's `RangeError`; proofs out of
 * order are not refused, since the encoder sorts them), a moment that is not a non-negative safe integer, and a request
 * naming another account or action than the client is bound to.
 */
export function assertSubmission(parts: RecoveryClientParts, request: AttemptRequest | CancelRequest, opening: boolean, now: Moment): void {
  const checked = checkedRequest(request);

  if (checked.opening !== opening) {
    throw new TypeError(opening ? 'request must be an opening request with a payload and an order' : 'request must be a cancel request');
  }

  sortedProofPlaces(request.proofs);
  assertUintNumber(now, FORMATS_SAFE_INTEGER_BITS, 'now');
  assertBoundRequest(request, parts.account, parts.action);
}

/** Refuses with a `KitRefusalError` carrying one `handover.malformed` finding a payload the codec does not decode. */
export function assertPayloadDecodes(parts: RecoveryClientParts, payload: Hex): void {
  try {
    parts.codec.decode(payload);
  } catch {
    throw new KitRefusalError(RECOVERY_CLIENT_PAYLOAD_MALFORMED_MESSAGE, {
      findings: {
        errors: [{ code: 'handover.malformed', subject: 'request', values: { zeroNew: false, zeroRemoved: false, layoutDecodes: false } }],
        warnings: [],
      },
    });
  }
}
