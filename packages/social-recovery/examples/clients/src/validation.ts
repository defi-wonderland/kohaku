import {
  type AttemptRequest,
  type CancelRequest,
  type HandoverReads,
  type IProvider,
  type Moment,
  type PinnedBlock,
  type RequestValidationContext,
  validateRequest,
} from '@kohaku-eth/social-recovery';
import { type Address, decodeFunctionResult, encodeFunctionData, erc20Abi, isAddressEqual, zeroAddress } from 'viem';
import type { Kit } from './clients';
import { findings, note, step } from './trace';

/** The opening request's handover reads: the payload decoded by the codec and the action's two answers about its keys. */
async function handoverReads(kit: Kit, request: AttemptRequest, block: PinnedBlock): Promise<HandoverReads> {
  let handover;

  try {
    handover = kit.codec.decode(request.payload);
  } catch {
    return { handover: { newAuthority: zeroAddress }, layoutDecodes: false, newHoldsAnyPrivilege: false };
  }

  const removed = handover.removedAuthority;

  return {
    handover,
    layoutDecodes: true,
    ...(removed === undefined ? {} : { removedIsAuthority: await kit.recoveryAction.isAuthority(removed, block) }),
    newHoldsAnyPrivilege: await kit.recoveryAction.holdsAnyPrivilege(handover.newAuthority, block),
  };
}

/**
 * The account's balance in the order's ERC-20 through `balanceOf`. A zero order has no payment leg and reads no token;
 * the native asset is not read and never warns.
 */
async function orderBalance(provider: IProvider, request: AttemptRequest, block: PinnedBlock): Promise<bigint> {
  const { token, amount } = request.order;

  if (amount === 0n) return 0n;

  if (isAddressEqual(token, zeroAddress)) return amount;

  const data = encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [request.account] });
  const answer = await provider.call(token, data, request.account, block.number);

  return decodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', data: answer });
}

/**
 * Assembles the request's validation context from the parts' reads at one pinned block, runs the pure `validateRequest`,
 * prints its findings and throws on any error, so the prepare is reached only with a clean request.
 */
export async function checkRequest(kit: Kit, provider: IProvider, request: AttemptRequest | CancelRequest, moment: Moment): Promise<void> {
  step('validateRequest (pure, context from the parts\' reads)');

  const header = await provider.block(kit.configuration.blockTags.read);
  const block: PinnedBlock = { number: header.number, hash: header.hash };
  const methods = [...new Set(request.proofs.map((proof) => proof.method))] as Address[];
  const opening = 'payload' in request;
  const context: RequestValidationContext = {
    state: await kit.policyManager.stateOf(block),
    block: header,
    moment,
    configuration: kit.configuration,
    paused: await Promise.all(methods.map(async (method) => ({ method, paused: await kit.policyManager.paused(method, block) }))),
    implementedMethods: kit.method.modules(kit.descriptor),
    ...(opening ? { handover: await handoverReads(kit, request, block), balance: await orderBalance(provider, request, block) } : {}),
  };

  note('pinned block', block.number);

  const result = validateRequest(request, context);

  findings(result);

  if (result.errors.length > 0) throw new Error(`validateRequest found ${result.errors.length} error(s); the request is not submitted`);
}
