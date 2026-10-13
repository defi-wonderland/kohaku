import {
  type Attempt,
  POLICY_MANAGER_WRITES_ABI,
  type PreparedCall,
  RECOVERY_ACTION_SET_ADDR_PRIVILEGE_SELECTOR,
} from '@kohaku-eth/social-recovery';
import { type Address, erc20Abi, isAddressEqual, slice, toFunctionSelector, type TransactionReceipt, zeroAddress } from 'viem';
import type { Session } from './session';
import type { SetupOutcome } from './setup';
import { check, note, step } from './trace';

const COMMIT_SETUP_SELECTOR = toFunctionSelector(POLICY_MANAGER_WRITES_ABI[0]);

const selectorOf = (call: PreparedCall): string => slice(call.data, 0, 4).toLowerCase();

/**
 * On an account the action was not authorized on before the setup, the commit must be one atomic batch: the account's
 * own `setAddrPrivilege` first, the manager's `commitSetup` second. An already armed account needs no such batch.
 */
export function checkArmingBatch(outcome: SetupOutcome): void {
  step('check: the commit\'s shape');

  if (outcome.armedBefore || outcome.prepared === undefined) {
    note(outcome.armedBefore ? 'the account was armed before the setup: no arming batch expected' : 'nothing was prepared');

    return;
  }

  const { prepared } = outcome;

  check(prepared.kind === 'batch', 'an unarmed account\'s commit is a batch');
  check(prepared.atomic, 'the batch is marked atomic');
  check(prepared.calls.length === 2, 'the batch holds two calls');

  const [arming, commit] = prepared.calls as readonly [PreparedCall, PreparedCall];

  check(isAddressEqual(arming.target, outcome.account), 'the first call targets the account');
  check(selectorOf(arming) === RECOVERY_ACTION_SET_ADDR_PRIVILEGE_SELECTOR.toLowerCase(), 'the first call is setAddrPrivilege');
  check(isAddressEqual(commit.target, outcome.manager), 'the second call targets the manager');
  check(selectorOf(commit) === COMMIT_SETUP_SELECTOR.toLowerCase(), 'the second call is commitSetup');
}

/** The address the handover pays: the order's payee, or the sender of the execute (the sponsor) where the order is open. */
export const effectivePayee = (session: Session, attempt: Attempt): Address =>
  isAddressEqual(attempt.order.payee, zeroAddress) ? session.sponsor.account.address : attempt.order.payee;

/** The payee's balance in the order's asset at one block. */
async function balanceAt(session: Session, attempt: Attempt, payee: Address, blockNumber: bigint): Promise<bigint> {
  const { token } = attempt.order;

  if (isAddressEqual(token, zeroAddress)) return session.client.getBalance({ address: payee, blockNumber });

  return session.client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [payee], blockNumber });
}

/**
 * For a nonzero order, the payee's balance rose by the amount across the execute's block. Where the sponsor is paid in
 * the native asset, the gas it paid for the execute is counted back.
 */
export async function checkPayment(session: Session, attempt: Attempt, receipt: TransactionReceipt): Promise<void> {
  const { amount, token } = attempt.order;

  step('check: the payment');

  if (amount === 0n) {
    note('zero order: no payment leg');

    return;
  }

  const payee = effectivePayee(session, attempt);
  const before = await balanceAt(session, attempt, payee, receipt.blockNumber - 1n);
  const after = await balanceAt(session, attempt, payee, receipt.blockNumber);
  const sponsorPaysGas = isAddressEqual(token, zeroAddress) && isAddressEqual(payee, session.sponsor.account.address);
  const gas = sponsorPaysGas ? receipt.gasUsed * receipt.effectiveGasPrice : 0n;

  note('payee', payee);
  note('balance before / after', { before, after, gasCountedBack: gas });
  check(after - before + gas === amount, `the payee received ${amount}`);
}

/** After the execute, the action is still authorized on the account. */
export async function checkStillAuthorized(session: Session): Promise<void> {
  const state = await session.kit.setup.setupState();

  check(state.isAuthorized, 'the action is still authorized on the account');
}
