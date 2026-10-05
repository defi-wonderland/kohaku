import { decodeAbiParameters, encodeAbiParameters, type AbiParameter, type DecodeAbiParametersReturnType } from 'viem';
import { FORMATS_HEX_BYTES_PATTERN, FORMATS_SAFE_INTEGER_BITS, POLICY_MANAGER_READ_FROM } from '../constants';
import { assertBytes32, assertObject, assertUintNumber } from '../formats/guards';
import { isProviderRevert, type Address, type BlockTag, type Hex, type IProvider, type PinnedBlock } from '../interfaces';
import type { CallOutcome } from '../types/policy-manager';

/** The block the tag names at this moment, read once; a header that is not a block number and a 32-byte hash throws. */
export async function pinBlock(provider: IProvider, tag: BlockTag): Promise<PinnedBlock> {
  const header: unknown = await provider.block(tag);

  assertObject(header, 'block');

  const { number, hash } = header as { number: unknown; hash: unknown };

  assertUintNumber(number, FORMATS_SAFE_INTEGER_BITS, 'block.number');
  assertBytes32(hash, 'block.hash');

  return { number, hash: hash.toLowerCase() as Hex };
}

/** One view call at the pinned block; a revert and a transport failure reject as the provider rejected. */
export const readCall = (provider: IProvider, to: Address, data: Hex, block: PinnedBlock): Promise<Hex> =>
  provider.call(to, data, POLICY_MANAGER_READ_FROM, block.number);

/** One view call to a module, telling a contract that returned or reverted from a provider that failed. */
export async function moduleCall(provider: IProvider, to: Address, data: Hex, block: PinnedBlock): Promise<CallOutcome> {
  let returned: unknown;

  try {
    returned = await readCall(provider, to, data, block);
  } catch (thrown) {
    return isProviderRevert(thrown) ? { kind: 'reverted' } : { kind: 'failed' };
  }

  if (typeof returned !== 'string' || !FORMATS_HEX_BYTES_PATTERN.test(returned)) return { kind: 'failed' };

  return { kind: 'returned', data: returned.toLowerCase() as Hex };
}

/**
 * Decodes a view's return, refusing with a `TypeError` bytes that are not hex, do not decode,
 * or are not the canonical encoding the decoded values re-encode to.
 */
export function decodeReturn<const Params extends readonly AbiParameter[]>(
  params: Params,
  returned: unknown,
  view: string,
): DecodeAbiParametersReturnType<Params> {
  if (typeof returned !== 'string' || !FORMATS_HEX_BYTES_PATTERN.test(returned)) {
    throw new TypeError(`${view} returned something other than 0x-prefixed hex of whole bytes`);
  }

  const lowered = returned.toLowerCase() as Hex;
  let canonical: boolean;
  let decoded: DecodeAbiParametersReturnType<Params>;

  try {
    decoded = decodeAbiParameters(params, lowered);
    canonical = encodeAbiParameters(params, decoded as never) === lowered;
  } catch (cause) {
    throw new TypeError(`${view} returned bytes that do not decode`, { cause });
  }

  if (!canonical) throw new TypeError(`${view} returned bytes that are not the canonical encoding of its return`);

  return decoded;
}

/** The decoded return, or nothing where the module reverted or returned bytes that do not decode. */
export function decodeModuleReturn<const Params extends readonly AbiParameter[]>(
  params: Params,
  outcome: CallOutcome,
  view: string,
): DecodeAbiParametersReturnType<Params> | undefined {
  if (outcome.kind !== 'returned') return undefined;

  try {
    return decodeReturn(params, outcome.data, view);
  } catch {
    return undefined;
  }
}
