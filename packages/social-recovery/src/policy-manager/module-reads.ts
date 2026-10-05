import { encodeFunctionData } from 'viem';
import {
  POLICY_MANAGER_NAME_ABI,
  POLICY_MANAGER_PAUSED_ABI,
  POLICY_MANAGER_SUPPORTS_INTERFACE_ABI,
  POLICY_MANAGER_TRUE_WORD,
  POLICY_MANAGER_UNANSWERED,
  POLICY_MANAGER_TRUSTED_PARTIES_ABI,
  POLICY_MANAGER_VERSION_ABI,
  POLICY_METHOD_INTERFACE_ID,
} from '../constants';
import { normalizeAddress } from '../formats/guards';
import type { BlockTag, Hex, IProvider, ModuleInfo, Parties, PinnedBlock, ReadResult } from '../interfaces';
import type { CallOutcome } from '../types/policy-manager';
import { decodeModuleReturn, moduleCall, pinBlock } from './chain';
import { partiesFrom } from './records';

/** The block the tag names, or nothing where the provider failed to name one. */
async function tryPinBlock(provider: IProvider, tag: BlockTag): Promise<PinnedBlock | undefined> {
  try {
    return await pinBlock(provider, tag);
  } catch {
    return undefined;
  }
}

/** Calls each view of the module at one block, or answers nothing where no block could be pinned. */
async function moduleCalls(
  provider: IProvider,
  module: unknown,
  tag: BlockTag,
  calls: readonly Hex[],
): Promise<readonly CallOutcome[] | undefined> {
  const target = normalizeAddress(module, 'module');
  const block = await tryPinBlock(provider, tag);

  if (block === undefined) return undefined;

  return Promise.all(calls.map((data) => moduleCall(provider, target, data, block)));
}

/** Stopped only on a successful return of exactly the ABI encoding of `true`. */
const isExactlyTrue = (outcome: CallOutcome): boolean => outcome.kind === 'returned' && outcome.data === POLICY_MANAGER_TRUE_WORD;

/** Whether the module is stopped: a revert, an empty return or any other word is an answer of not stopped. */
export async function readPaused(provider: IProvider, module: unknown, tag: BlockTag): Promise<ReadResult<boolean>> {
  const outcomes = await moduleCalls(provider, module, tag, [encodeFunctionData({ abi: POLICY_MANAGER_PAUSED_ABI })]);
  const outcome = outcomes?.[0];

  if (outcome === undefined || outcome.kind === 'failed') return POLICY_MANAGER_UNANSWERED;

  return { answered: true, value: isExactlyTrue(outcome) };
}

/** The module's declared parties; a revert or a return that does not decode answers nothing. */
export async function readTrustedParties(provider: IProvider, module: unknown, tag: BlockTag): Promise<ReadResult<Parties>> {
  const outcomes = await moduleCalls(provider, module, tag, [encodeFunctionData({ abi: POLICY_MANAGER_TRUSTED_PARTIES_ABI })]);
  const outcome = outcomes?.[0];

  if (outcome === undefined || outcome.kind !== 'returned') return POLICY_MANAGER_UNANSWERED;

  try {
    return { answered: true, value: partiesFrom(outcome.data) };
  } catch {
    return POLICY_MANAGER_UNANSWERED;
  }
}

/**
 * The module's name, version and answer to the method interface's ERC-165 probe.
 * A probe that reverts or returns anything but exactly `true` reads as unsupported; a failed or
 * undecodable name or version answers nothing.
 */
export async function readModuleInfo(provider: IProvider, module: unknown, tag: BlockTag): Promise<ReadResult<ModuleInfo>> {
  const outcomes = await moduleCalls(provider, module, tag, [
    encodeFunctionData({ abi: POLICY_MANAGER_NAME_ABI }),
    encodeFunctionData({ abi: POLICY_MANAGER_VERSION_ABI }),
    encodeFunctionData({ abi: POLICY_MANAGER_SUPPORTS_INTERFACE_ABI, args: [POLICY_METHOD_INTERFACE_ID] }),
  ]);

  if (outcomes === undefined) return POLICY_MANAGER_UNANSWERED;

  const [nameOutcome, versionOutcome, probeOutcome] = outcomes as [CallOutcome, CallOutcome, CallOutcome];
  const name = decodeModuleReturn(POLICY_MANAGER_NAME_ABI[0].outputs, nameOutcome, 'name');
  const version = decodeModuleReturn(POLICY_MANAGER_VERSION_ABI[0].outputs, versionOutcome, 'version');

  if (name === undefined || version === undefined || probeOutcome.kind === 'failed') return POLICY_MANAGER_UNANSWERED;

  return { answered: true, value: { name: name[0], version: version[0], supportsInterface: isExactlyTrue(probeOutcome) } };
}
