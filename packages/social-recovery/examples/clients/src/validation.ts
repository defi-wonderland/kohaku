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
async function handoverReads(kit: Kit, request: AttemptRequest, block: PinnedBlock, settle: () => void): Promise<HandoverReads> {
  let handover;

  try {
    handover = kit.codec.decode(request.payload);
  } catch {
    return { handover: { newAuthority: zeroAddress }, layoutDecodes: false, newHoldsAnyPrivilege: false };
  }

  const removed = handover.removedAuthority;
  const removedIsAuthority = removed === undefined ? undefined : await kit.recoveryAction.isAuthority(removed, block);

  settle();

  const newHoldsAnyPrivilege = await kit.recoveryAction.holdsAnyPrivilege(handover.newAuthority, block);

  settle();

  return {
    handover,
    layoutDecodes: true,
    ...(removedIsAuthority === undefined ? {} : { removedIsAuthority }),
    newHoldsAnyPrivilege,
  };
}

/** Reads an address's native balance at a block number; the `IProvider` has no such read. */
export type NativeBalance = (address: Address, blockNumber: number) => Promise<bigint>;

/**
 * The account's balance in the order's asset at the pinned block: the native balance through `nativeBalance` for the
 * zero-address token, else the ERC-20's `balanceOf`. A zero order has no payment leg and reads nothing.
 */
async function orderBalance(
  provider: IProvider,
  nativeBalance: NativeBalance,
  request: AttemptRequest,
  block: PinnedBlock,
  settle: () => void,
): Promise<bigint> {
  const { token, amount } = request.order;

  if (amount === 0n) return 0n;

  if (isAddressEqual(token, zeroAddress)) {
    const native = await nativeBalance(request.account, block.number);

    settle();

    return native;
  }

  const data = encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [request.account] });
  const answer = await provider.call(token, data, request.account, block.number);

  settle();

  return decodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', data: answer });
}

/**
 * Assembles the request's validation context from the parts' reads at one pinned block, runs the pure `validateRequest`,
 * prints its findings and throws on any error, so the prepare is reached only with a clean request.
 * `settle` runs after each awaited read, before anything is traced; a page passes its session check, which throws.
 */
export async function checkRequest(
  kit: Kit,
  provider: IProvider,
  nativeBalance: NativeBalance,
  request: AttemptRequest | CancelRequest,
  moment: Moment,
  settle: () => void = () => undefined,
): Promise<void> {
  step('validateRequest (pure, context from the parts\' reads)');

  const header = await provider.block(kit.configuration.blockTags.read);

  settle();

  const block: PinnedBlock = { number: header.number, hash: header.hash };
  const methods = [...new Set(request.proofs.map((proof) => proof.method))] as Address[];
  const state = await kit.policyManager.stateOf(block);

  settle();

  const paused = await Promise.all(methods.map(async (method) => ({ method, paused: await kit.policyManager.paused(method, block) })));

  settle();

  const opening = 'payload' in request
    ? { handover: await handoverReads(kit, request, block, settle), balance: await orderBalance(provider, nativeBalance, request, block, settle) }
    : {};

  settle();

  const context: RequestValidationContext = {
    state,
    block: header,
    moment,
    configuration: kit.configuration,
    paused,
    implementedMethods: kit.method.modules(kit.descriptor),
    ...opening,
  };

  note('pinned block', block.number);

  const result = validateRequest(request, context);

  findings(result);

  if (result.errors.length > 0) throw new Error(`validateRequest found ${result.errors.length} error(s); the request is not submitted`);
}
