// SPDX-License-Identifier: MIT
/**
 * @file recoveryV0Client.ts
 * @module @kohaku-eth/recovery (v0 mirror)
 *
 * @summary
 * SDK glue for recovery **v0**, where the controller speaks REAL ERC-7579. This is a
 * faithful TypeScript twin of the on-chain `RecoveryController` +
 * `IERC7579Account` (native `Minimal7579Account` or `AmbireExecutorAdapter`).
 *
 * @remarks
 * WHAT CHANGED FROM THE PoC. The PoC controller's entrypoint was
 * `initiateRecovery(address account, address newOwner, bytes proof)` and it drove the
 * account through a custom `IAccountAdapter.rotateSigner` seam (see
 * {@link ./recoveryAdapterClient.ts}). v0 binds the target at controller construction
 * and rotates through the standard ERC-7579 executor primitive, so the entrypoint is
 * `initiateRecovery(address newOwner, bytes proof)` and the on-chain interaction is
 * `target.executeFromExecutor(MODE_SINGLE_DEFAULT, encodeSingle(target, 0,
 * rotateOwner(newOwner)))`.
 *
 * Consumers must use the v0 ABI ({@link RECOVERY_CONTROLLER_V0_ABI}); the PoC ABI's
 * 3-arg `initiateRecovery` does NOT match the v0 controller. The `recoveryHash`
 * encoding is preserved, so {@link computeRecoveryHash} from the PoC module still
 * matches (use scheme `'controllerBound'` with `account = the controller's target`).
 *
 * This is a PURE encoder module: no network calls, no private keys, no hardcoded
 * addresses. Dependency: `viem` for ABI encoding (ethers consumers can use the
 * exported fragments).
 */

import {
  type Abi,
  type Address,
  type Hex,
  encodeFunctionData,
  encodePacked,
  toFunctionSelector,
} from 'viem';

// ---------------------------------------------------------------------------
// Constants — mirror the on-chain ERC7579Mode library + RecoveryController
// ---------------------------------------------------------------------------

/**
 * The only ERC-7579 `ModeCode` recovery v0 emits: callType=single (0x00),
 * execType=default (0x00), no selector, no payload — i.e. the zero word. Mirrors
 * `ERC7579Mode.MODE_SINGLE_DEFAULT`.
 */
export const MODE_SINGLE_DEFAULT: Hex =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

/**
 * The canonical owner-rotation selector the controller emits and the native account
 * honors: `bytes4(keccak256("rotateOwner(address)"))`. Equal to
 * `RecoveryController.ROTATE_OWNER_SELECTOR`.
 */
export const ROTATE_OWNER_SELECTOR: Hex = toFunctionSelector('rotateOwner(address)');

/** The Ambire "authorized" privilege value (`bytes32(uint256(1))`). */
export const PRIV_AUTHORIZED_V0: Hex =
  '0x0000000000000000000000000000000000000000000000000000000000000001';

// ---------------------------------------------------------------------------
// ABI fragments — the exact v0 on-chain surfaces this SDK touches
// ---------------------------------------------------------------------------

/**
 * The v0 `RecoveryController` entrypoint a relayer calls:
 * `initiateRecovery(address newOwner, bytes proof)`. The target/account is bound at
 * construction, so it is NOT an argument here (unlike the PoC's 3-arg version).
 */
export const RECOVERY_CONTROLLER_V0_ABI = [
  {
    type: 'function',
    name: 'initiateRecovery',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'newOwner', type: 'address' },
      { name: 'proof', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'recoveryNonce',
    stateMutability: 'view',
    inputs: [{ name: 'target', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'pendingRecoveryHash',
    stateMutability: 'view',
    inputs: [{ name: 'newOwner', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'target',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const satisfies Abi;

/**
 * The ERC-7579 executor surface the controller drives. Both the native account and
 * the Ambire adapter implement this; the SDK only ever needs this shape.
 */
export const IERC7579_ACCOUNT_ABI = [
  {
    type: 'function',
    name: 'executeFromExecutor',
    stateMutability: 'payable',
    inputs: [
      { name: 'mode', type: 'bytes32' },
      { name: 'executionCalldata', type: 'bytes' },
    ],
    outputs: [{ name: 'returnData', type: 'bytes[]' }],
  },
  {
    type: 'function',
    name: 'installModule',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'moduleTypeId', type: 'uint256' },
      { name: 'module', type: 'address' },
      { name: 'initData', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'isModuleInstalled',
    stateMutability: 'view',
    inputs: [
      { name: 'moduleTypeId', type: 'uint256' },
      { name: 'module', type: 'address' },
      { name: 'additionalContext', type: 'bytes' },
    ],
    outputs: [{ name: 'installed', type: 'bool' }],
  },
] as const satisfies Abi;

/** The native `Minimal7579Account` owner getter, for pre/post-state reads. */
export const MINIMAL_ACCOUNT_ABI = [
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const satisfies Abi;

// ---------------------------------------------------------------------------
// ERC-7579 single-call encoding — mirrors ERC7579Mode.encodeSingle
// ---------------------------------------------------------------------------

/**
 * Encode an ERC-7579 SINGLE `executionCalldata` exactly as
 * `ERC7579Mode.encodeSingle` does on-chain: the PACKED tuple
 * `abi.encodePacked(address to, uint256 value, bytes callData)` (no length prefix,
 * no padding).
 *
 * @param to       The call target.
 * @param value    Native value (wei) to forward.
 * @param callData ABI-encoded calldata for the call.
 * @returns The packed execution calldata as {@link Hex}.
 */
export function encodeSingleExecution(to: Address, value: bigint, callData: Hex): Hex {
  return encodePacked(['address', 'uint256', 'bytes'], [to, value, callData]);
}

/**
 * Encode the inner rotation call `rotateOwner(address newOwner)` — the canonical
 * rotation intent the controller wraps in a single 7579 execution.
 *
 * @param newOwner The address to install as the new signer.
 * @returns The 4-byte selector + ABI-encoded address as {@link Hex}.
 */
export function encodeRotateOwnerCall(newOwner: Address): Hex {
  return encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'rotateOwner',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'newOwner', type: 'address' }],
        outputs: [],
      },
    ] as const,
    functionName: 'rotateOwner',
    args: [newOwner],
  });
}

// ---------------------------------------------------------------------------
// Controller entrypoint encoder (the ONE call a relayer sends)
// ---------------------------------------------------------------------------

/**
 * Encode `controller.initiateRecovery(newOwner, proof)` calldata — the single,
 * owner-free call any relayer submits to rotate the bound target's signer. This is
 * the exact call the Kohaku extension's recovery controller sends.
 *
 * @param newOwner The address to grant signing authority to.
 * @param proof    Opaque, method-specific evidence. v0 default `'0x'` (AlwaysValid).
 * @returns ABI-encoded calldata as {@link Hex}.
 */
export function encodeInitiateRecoveryV0(newOwner: Address, proof: Hex = '0x'): Hex {
  return encodeFunctionData({
    abi: RECOVERY_CONTROLLER_V0_ABI,
    functionName: 'initiateRecovery',
    args: [newOwner, proof],
  });
}

/**
 * Build the EXACT ERC-7579 execution the v0 controller emits internally:
 * `executeFromExecutor(MODE_SINGLE_DEFAULT, encodeSingle(target, 0,
 * rotateOwner(newOwner)))`. Exposed so clients/tests can inspect the on-chain
 * interaction; in normal flow the controller constructs this — the relayer only sends
 * {@link encodeInitiateRecoveryV0}.
 *
 * @param target   The controller's bound 7579 target (native account or Ambire adapter).
 * @param newOwner The address to rotate to.
 * @returns The `(mode, executionCalldata)` pair the controller hands to the target.
 */
export function buildExecuteFromExecutorArgs(
  target: Address,
  newOwner: Address,
): { mode: Hex; executionCalldata: Hex } {
  const rotateCall = encodeRotateOwnerCall(newOwner);
  return {
    mode: MODE_SINGLE_DEFAULT,
    executionCalldata: encodeSingleExecution(target, 0n, rotateCall),
  };
}
