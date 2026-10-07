import { FORMATS_ZERO_ADDRESS, RECOVERY_CLIENT_NO_CODE, RECOVERY_CLIENT_UNANSWERED_READ_MESSAGE } from '../constants';
import { assertBytes, assertObject, lowerHex, normalizeAddress, sameAddress } from '../formats/guards';
import { decodeSigner } from '../method-ecdsa/codec';
import type { Address, Configuration, Credential, PinnedBlock, ReadResult } from '../interfaces';
import type { PlaceStanding } from '../types';
import type { MethodStop, RecoveryClientParts } from '../types/recovery-client';

/** The read's answer, rejecting where it went unanswered since no standing may be guessed. */
function answerOf<Answer>(result: ReadResult<Answer>, read: string, method: Address): Answer {
  assertObject(result, `${read}(${method})`);

  if (!result.answered) throw new Error(`${RECOVERY_CLIENT_UNANSWERED_READ_MESSAGE}: ${read}(${method})`);

  return result.value;
}

/** Each rule method's stop, read once per method in the order of its first place: stopped only on an exact `true`. */
async function methodStops(
  parts: RecoveryClientParts,
  methods: readonly Address[],
  block: PinnedBlock,
): Promise<Map<Address, MethodStop>> {
  const stops = new Map<Address, MethodStop>();

  for (const method of methods) {
    const paused = answerOf(await parts.policyManager.paused(method, block), 'paused', method);
    const parties = answerOf(await parts.policyManager.trustedParties(method, block), 'trustedParties', method);

    assertObject(parties, `trustedParties(${method})`);

    const pauseHolder = normalizeAddress(parties.pauseHolder, `trustedParties(${method}).pauseHolder`);

    stops.set(method, { standing: paused === true ? 'stopped' : 'not-stopped', stoppable: !sameAddress(pauseHolder, FORMATS_ZERO_ADDRESS) });
  }

  return stops;
}

/** The guardian address a wallet config holds, or nothing where the config is not one address word. */
function guardianOf(config: Credential['config']): Address | undefined {
  try {
    return decodeSigner(config);
  } catch {
    return undefined;
  }
}

/** Whether each guardian address holds code at the block, one read per distinct address. */
async function guardianCode(parts: RecoveryClientParts, guardians: readonly Address[], block: PinnedBlock): Promise<Map<Address, boolean>> {
  const holds = new Map<Address, boolean>();

  for (const guardian of guardians) {
    if (holds.has(guardian)) continue;

    const code: unknown = await parts.provider.code(guardian, block.number);

    assertBytes(code, `code(${guardian})`);
    holds.set(guardian, lowerHex(code) !== RECOVERY_CLIENT_NO_CODE);
  }

  return holds;
}

/**
 * Each place's standing in body order: its method's stop and pause holder, and for a wallet place whether its guardian
 * address holds code; every other method's place holds none. Every read is pinned to `block`.
 */
export async function placeStandings(
  parts: RecoveryClientParts,
  configuration: Configuration,
  block: PinnedBlock,
): Promise<PlaceStanding[]> {
  const credentials = configuration.clauses.flatMap((clause) => clause.credentials);
  const methods = credentials.map((credential, place) => normalizeAddress(credential.method, `place ${place} method`));
  const stops = await methodStops(parts, [...new Set(methods)], block);
  const guardians = methods.map((method, place) =>
    sameAddress(method, parts.walletMethod) ? guardianOf((credentials[place] as Credential).config) : undefined,
  );
  const code = await guardianCode(parts, guardians.filter((guardian) => guardian !== undefined), block);

  return methods.map((method, place) => {
    const guardian = guardians[place];

    return { ...(stops.get(method) as MethodStop), credentialHoldsCode: guardian === undefined ? false : code.get(guardian) === true };
  });
}
