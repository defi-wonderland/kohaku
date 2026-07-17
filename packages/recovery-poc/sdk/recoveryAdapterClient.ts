// SPDX-License-Identifier: MIT
/**
 * @file recoveryAdapterClient.ts
 * @module @kohaku-eth/recovery (PoC mirror)
 *
 * @summary
 * SDK glue for the recovery-adapter PoC. This module is the TypeScript surface a
 * Kohaku client (the browser extension, a relayer, a CLI) uses to drive the
 * `RecoveryControllerPoC` → `AmbireAccountAdapter` → real `AmbireAccount`
 * execution seam.
 *
 * @remarks
 * What this proves, in SDK terms: the *entire* client-side footprint of host
 * recovery is "encode two calls":
 *   1. {@link buildAuthorizeAdapterCall} — ONE owner-signed setup call, wrapped in
 *      `executeBySender`, that grants the adapter an Ambire privilege. This is the
 *      only step that requires the account owner.
 *   2. {@link buildInitiateRecoveryCall} — the recovery-time call, sendable by ANY
 *      relayer (no owner key), that asks the controller to verify a method proof
 *      and rotate the signer.
 *
 * Everything host-specific (Ambire's `executeBySender` + self-called
 * `setAddrPrivilege`) is confined to the calldata builders here and to the
 * on-chain `AmbireAccountAdapter`. The controller-facing builders
 * ({@link buildInitiateRecoveryCall}, {@link computeRecoveryHash}) are
 * host-agnostic — they would be byte-identical against a 7579 adapter.
 *
 * This is a PURE calldata-builder module: no network calls, no private keys, no
 * hardcoded addresses. A live provider plugs in via {@link RecoveryClient} (see
 * the "runtime wiring" section), but the PoC needs none of it.
 *
 * Dependency: `viem` for ABI encoding / keccak. (If a consumer is on `ethers`,
 * the same calldata can be produced from these ABI fragments — they are exported.)
 *
 * Mirrors how the extension consumes `@kohaku-eth/*` today: thin typed
 * encoders + an optional client wrapper, not a monolith.
 */

import {
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Account,
  type Chain,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
} from 'viem';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single call in a batch. Field-compatible with on-chain
 * `IAccountAdapter.Call` and Ambire's `Transaction { address to; uint256 value;
 * bytes data; }`. Values are `bigint` to match `uint256`.
 */
export interface Call {
  to: Address;
  value: bigint;
  data: Hex;
}

/**
 * The four addresses that fully describe a wired-up recovery setup. No address
 * is hardcoded anywhere in this module; callers pass this in.
 *
 * - `account`    — the Ambire smart account being protected / recovered.
 * - `controller` — the deployed `RecoveryControllerPoC` (policy + orchestration).
 * - `adapter`    — the deployed `AmbireAccountAdapter` (the host seam).
 * - `method`     — the deployed `IRecoveryMethod` leg (PoC: `AlwaysValidMethod`).
 */
export interface RecoveryConfig {
  account: Address;
  controller: Address;
  adapter: Address;
  method: Address;
}

/**
 * Selects how {@link computeRecoveryHash} packs the recovery commitment so it
 * matches the encoding the *deployed* `RecoveryControllerPoC` uses on-chain.
 *
 * The PoC's contract and SDK must agree byte-for-byte, so this is explicit
 * rather than guessed:
 *
 * - `'controllerBound'` (default, MATCHES the deployed `RecoveryControllerPoC`)
 *   — `keccak256(abi.encode(address controller, uint256 chainId, address
 *   account, address newOwner, uint256 nonce))`. This is exactly what
 *   `RecoveryControllerPoC._recoveryHash` computes on-chain
 *   (`keccak256(abi.encode(address(this), block.chainid, account, newOwner,
 *   nonce))`), so a real `IRecoveryMethod` proof bound to this hash verifies.
 *   It binds the commitment to the specific controller + chain + account +
 *   target signer + per-account nonce (full anti-replay / anti-cross-domain).
 *
 * The following are NON-MATCHING legacy sketches kept only for reference; do
 * NOT use them against the current controller (they will be rejected):
 * - `'newOwnerNonce'` — `keccak256(abi.encode(address newOwner, uint256 nonce))`.
 * - `'accountNewOwnerChainId'` — `keccak256(abi.encode(address account, address
 *   newOwner, uint256 chainId))`.
 *
 * The method proof must be bound to the SAME hash the controller computes, so
 * getting this right is the whole point of mirroring the contract off-chain.
 */
export type RecoveryHashScheme =
  | 'controllerBound'
  | 'newOwnerNonce'
  | 'accountNewOwnerChainId';

// ---------------------------------------------------------------------------
// ABI fragments (the exact on-chain surfaces this SDK touches)
// ---------------------------------------------------------------------------

/**
 * Minimal Ambire account ABI — only the two functions the recovery flow uses.
 * Verified against
 * `kohaku-extension/src/ambire-common/contracts/deployless/IAmbireAccount.sol`:
 *   - `executeBySender(Transaction[] calls)` where
 *     `Transaction { address to; uint256 value; bytes data; }`
 *   - `setAddrPrivilege(address addr, bytes32 priv)` (self-call-only on-chain).
 */
export const AMBIRE_ACCOUNT_ABI = [
  {
    type: 'function',
    name: 'executeBySender',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setAddrPrivilege',
    stateMutability: 'payable',
    inputs: [
      { name: 'addr', type: 'address' },
      { name: 'priv', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'privileges',
    stateMutability: 'view',
    inputs: [{ name: 'key', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
] as const satisfies Abi;

/**
 * Minimal `RecoveryControllerPoC` ABI — the single entrypoint a relayer calls.
 * `initiateRecovery(address account, address newOwner, bytes proof)`.
 */
export const RECOVERY_CONTROLLER_ABI = [
  {
    type: 'function',
    name: 'initiateRecovery',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'newOwner', type: 'address' },
      { name: 'proof', type: 'bytes' },
    ],
    outputs: [],
  },
] as const satisfies Abi;

/**
 * The Ambire privilege value granted to an authorized key/executor. On-chain
 * this is `bytes32(uint256(1))` — a truthy, non-recovery privilege. The account
 * treats any non-zero privilege as "this address may act"; `0x..01` is the
 * canonical "plain authorized signer / executor" marker.
 */
export const PRIV_AUTHORIZED: Hex =
  '0x0000000000000000000000000000000000000000000000000000000000000001';

/** The zero privilege — i.e. "not authorized". Useful for off-chain checks. */
export const PRIV_NONE: Hex =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

// ---------------------------------------------------------------------------
// (a) Authorize the adapter on the Ambire account  [owner-signed, once]
// ---------------------------------------------------------------------------

/**
 * Build the inner `setAddrPrivilege(adapter, 0x..01)` call that grants the
 * recovery adapter an Ambire privilege on `account`.
 *
 * @remarks
 * On-chain, `setAddrPrivilege` is self-call-only (`msg.sender == address(this)`),
 * so this call's `to` is the account itself: the account must self-call it. It is
 * therefore meant to be wrapped — see {@link buildAuthorizeAdapterCall}, which
 * packages it inside an `executeBySender` batch that the *current owner* submits.
 *
 * This is the ONE setup step that needs the account owner. After it, recovery is
 * owner-free.
 *
 * @param account The Ambire account being protected.
 * @param adapter The deployed `AmbireAccountAdapter` to authorize as executor.
 * @param priv    Privilege value to grant. Defaults to {@link PRIV_AUTHORIZED}.
 * @returns A {@link Call} with `to = account`, encoding `setAddrPrivilege`.
 */
export function buildSetAdapterPrivilegeCall(
  account: Address,
  adapter: Address,
  priv: Hex = PRIV_AUTHORIZED,
): Call {
  return {
    to: account,
    value: 0n,
    data: encodeFunctionData({
      abi: AMBIRE_ACCOUNT_ABI,
      functionName: 'setAddrPrivilege',
      args: [adapter, priv],
    }),
  };
}

/**
 * Build the FULL owner-signed onboarding call that authorizes the adapter:
 * `executeBySender([ setAddrPrivilege(adapter, 0x..01) ])`, sent to `account`.
 *
 * @remarks
 * The owner (an address already in the account's `privileges`) submits this. The
 * account's `executeBySender` checks the caller is privileged, then self-calls
 * `setAddrPrivilege`, satisfying its self-call guard. This is the realistic
 * "owner authorizes the recovery executor during onboarding" transaction.
 *
 * @param account The Ambire account being protected.
 * @param adapter The deployed `AmbireAccountAdapter` to authorize as executor.
 * @param priv    Privilege value to grant. Defaults to {@link PRIV_AUTHORIZED}.
 * @returns A {@link Call} the owner sends to `account` (`to = account`).
 */
export function buildAuthorizeAdapterCall(
  account: Address,
  adapter: Address,
  priv: Hex = PRIV_AUTHORIZED,
): Call {
  const inner = buildSetAdapterPrivilegeCall(account, adapter, priv);
  return {
    to: account,
    value: 0n,
    data: encodeExecuteBySender([inner]),
  };
}

// ---------------------------------------------------------------------------
// (b) Initiate recovery (rotate to newOwner) through the controller  [no owner]
// ---------------------------------------------------------------------------

/**
 * Build the recovery-time call any relayer submits to the controller to rotate
 * the account's signer to `newOwner`:
 * `controller.initiateRecovery(account, newOwner, proof)`.
 *
 * @remarks
 * No owner key is involved. The controller verifies the method proof against the
 * recovery commitment, then asks the adapter to rotate the signer via the
 * account's own `executeBySender` → `setAddrPrivilege`. In the PoC the method is
 * `AlwaysValidMethod`, so `proof` may be `'0x'`.
 *
 * @param config   The wired recovery setup (uses `controller`).
 * @param newOwner The address to grant signing authority to.
 * @param proof    Opaque, method-specific evidence. PoC default: `'0x'`.
 * @returns A {@link Call} with `to = controller`, encoding `initiateRecovery`.
 */
export function buildInitiateRecoveryCall(
  config: Pick<RecoveryConfig, 'account' | 'controller'>,
  newOwner: Address,
  proof: Hex = '0x',
): Call {
  return {
    to: config.controller,
    value: 0n,
    data: encodeFunctionData({
      abi: RECOVERY_CONTROLLER_ABI,
      functionName: 'initiateRecovery',
      args: [config.account, newOwner, proof],
    }),
  };
}

/**
 * Build the inner rotation call the ADAPTER ultimately feeds to the account:
 * `setAddrPrivilege(newOwner, 0x..01)` with `to = account`.
 *
 * @remarks
 * Exposed for clients (or tests) that want to mirror exactly what the on-chain
 * `AmbireAccountAdapter.rotateSigner` builds before routing it through
 * `executeBySender`. In normal flow the client does NOT send this — the adapter
 * constructs it — but having it here makes the host mechanism inspectable and
 * keeps the SDK a faithful twin of the contract.
 *
 * @param account  The Ambire account whose signer is rotating.
 * @param newOwner The address to grant signing authority to.
 * @param priv     Privilege value to grant. Defaults to {@link PRIV_AUTHORIZED}.
 * @returns A {@link Call} encoding the rotation `setAddrPrivilege`.
 */
export function buildRotateSignerCall(
  account: Address,
  newOwner: Address,
  priv: Hex = PRIV_AUTHORIZED,
): Call {
  return buildSetAdapterPrivilegeCall(account, newOwner, priv);
}

// ---------------------------------------------------------------------------
// (c) Off-chain recoveryHash — MUST match the controller's on-chain computation
// ---------------------------------------------------------------------------

/**
 * Compute the off-chain `recoveryHash` that a method proof must be bound to,
 * mirroring the controller's on-chain computation so the proof verifies.
 *
 * @remarks
 * Correctness here is load-bearing: the controller recomputes this hash on-chain
 * and passes it to `IRecoveryMethod.verify(account, recoveryHash, proof)`. If the
 * off-chain bytes diverge from the on-chain `abi.encode(...)`, every real method
 * proof fails. The {@link RecoveryHashScheme} switch exists precisely so the SDK
 * tracks whichever encoding the deployed controller uses (see that type's docs).
 *
 * @param params.scheme    Which encoding the controller uses. Default
 *                         `'controllerBound'` — matches the deployed
 *                         `RecoveryControllerPoC` (see {@link RecoveryHashScheme}).
 * @param params.controller The `RecoveryControllerPoC` address. Required for
 *                         `'controllerBound'`.
 * @param params.account   The account being recovered. Required for
 *                         `'controllerBound'` and `'accountNewOwnerChainId'`.
 * @param params.chainId   The chain id. Required for `'controllerBound'` and
 *                         `'accountNewOwnerChainId'`.
 * @param params.newOwner  The address recovery rotates to.
 * @param params.nonce     Per-account recovery nonce. Required for
 *                         `'controllerBound'` and `'newOwnerNonce'`.
 * @returns The 32-byte recovery commitment as {@link Hex}.
 * @throws If required fields for the chosen scheme are missing.
 */
export function computeRecoveryHash(params: {
  newOwner: Address;
  scheme?: RecoveryHashScheme;
  controller?: Address;
  nonce?: bigint;
  account?: Address;
  chainId?: bigint;
}): Hex {
  const scheme: RecoveryHashScheme = params.scheme ?? 'controllerBound';

  if (scheme === 'controllerBound') {
    if (
      params.controller === undefined ||
      params.account === undefined ||
      params.chainId === undefined ||
      params.nonce === undefined
    ) {
      throw new Error(
        "computeRecoveryHash: scheme 'controllerBound' requires `controller`, `account`, `chainId`, and `nonce`",
      );
    }
    // keccak256(abi.encode(address controller, uint256 chainId, address account,
    //                      address newOwner, uint256 nonce))
    // MUST match RecoveryControllerPoC._recoveryHash:
    //   keccak256(abi.encode(address(this), block.chainid, account, newOwner, nonce))
    return keccak256(
      encodeAbiParameters(
        [
          { name: 'controller', type: 'address' },
          { name: 'chainId', type: 'uint256' },
          { name: 'account', type: 'address' },
          { name: 'newOwner', type: 'address' },
          { name: 'nonce', type: 'uint256' },
        ],
        [
          params.controller,
          params.chainId,
          params.account,
          params.newOwner,
          params.nonce,
        ],
      ),
    );
  }

  if (scheme === 'newOwnerNonce') {
    if (params.nonce === undefined) {
      throw new Error(
        "computeRecoveryHash: scheme 'newOwnerNonce' requires `nonce`",
      );
    }
    // keccak256(abi.encode(address newOwner, uint256 nonce))
    return keccak256(
      encodeAbiParameters(
        [
          { name: 'newOwner', type: 'address' },
          { name: 'nonce', type: 'uint256' },
        ],
        [params.newOwner, params.nonce],
      ),
    );
  }

  // 'accountNewOwnerChainId'
  if (params.account === undefined || params.chainId === undefined) {
    throw new Error(
      "computeRecoveryHash: scheme 'accountNewOwnerChainId' requires `account` and `chainId`",
    );
  }
  // keccak256(abi.encode(address account, address newOwner, uint256 chainId))
  return keccak256(
    encodeAbiParameters(
      [
        { name: 'account', type: 'address' },
        { name: 'newOwner', type: 'address' },
        { name: 'chainId', type: 'uint256' },
      ],
      [params.account, params.newOwner, params.chainId],
    ),
  );
}

// ---------------------------------------------------------------------------
// Shared encoders (host primitive: Ambire executeBySender)
// ---------------------------------------------------------------------------

/**
 * Encode `executeBySender(Transaction[])` calldata for the Ambire account.
 * `Transaction` is field-identical to {@link Call}, so a `Call[]` maps directly.
 *
 * @param calls Batch to execute on the account's behalf.
 * @returns ABI-encoded calldata as {@link Hex}.
 */
export function encodeExecuteBySender(calls: Call[]): Hex {
  return encodeFunctionData({
    abi: AMBIRE_ACCOUNT_ABI,
    functionName: 'executeBySender',
    args: [calls.map((c) => ({ to: c.to, value: c.value, data: c.data }))],
  });
}

/**
 * Encode `controller.initiateRecovery(account, newOwner, proof)` calldata.
 * Thin alias over {@link buildInitiateRecoveryCall}'s `.data` for callers that
 * only want the bytes.
 */
export function encodeInitiateRecovery(
  account: Address,
  newOwner: Address,
  proof: Hex = '0x',
): Hex {
  return encodeFunctionData({
    abi: RECOVERY_CONTROLLER_ABI,
    functionName: 'initiateRecovery',
    args: [account, newOwner, proof],
  });
}

// ---------------------------------------------------------------------------
// Optional runtime wiring (a real provider plugs in here)
// ---------------------------------------------------------------------------

/**
 * Thin client that turns the pure builders above into actual transactions. The
 * PoC needs none of this (the builders + Foundry tests prove the seam), but it
 * shows the exact two SDK touch-points a real consumer hits, and the place a
 * live `viem` provider plugs in.
 */
export class RecoveryClient {
  readonly config: RecoveryConfig;
  readonly publicClient?: PublicClient;

  constructor(config: RecoveryConfig, publicClient?: PublicClient) {
    this.config = config;
    this.publicClient = publicClient;
  }

  /**
   * Owner-signed onboarding: authorize the adapter as an executor on the
   * account. Sends `executeBySender([setAddrPrivilege(adapter, 0x..01)])`.
   *
   * @param wallet A `viem` WalletClient whose account is a current privileged
   *               owner of the Ambire account.
   * @returns The transaction hash.
   */
  async authorizeAdapter(
    wallet: WalletClient<any, Chain | undefined, Account>,
  ): Promise<Hex> {
    const call = buildAuthorizeAdapterCall(
      this.config.account,
      this.config.adapter,
    );
    return wallet.sendTransaction({
      account: wallet.account,
      chain: wallet.chain,
      to: call.to,
      value: call.value,
      data: call.data,
    });
  }

  /**
   * Recovery-time, owner-free: any relayer asks the controller to rotate the
   * signer to `newOwner`. Sends `controller.initiateRecovery(...)`.
   *
   * @param wallet   A `viem` WalletClient for ANY funded sender (a relayer EOA);
   *                 it need NOT be a privileged key of the account.
   * @param newOwner The address to grant signing authority to.
   * @param proof    Method-specific evidence. PoC default `'0x'`.
   * @returns The transaction hash.
   */
  async initiateRecovery(
    wallet: WalletClient<any, Chain | undefined, Account>,
    newOwner: Address,
    proof: Hex = '0x',
  ): Promise<Hex> {
    const call = buildInitiateRecoveryCall(this.config, newOwner, proof);
    return wallet.sendTransaction({
      account: wallet.account,
      chain: wallet.chain,
      to: call.to,
      value: call.value,
      data: call.data,
    });
  }

  /**
   * Read whether `key` currently holds a privilege on the account. Handy to
   * assert pre/post state around a recovery (off-chain mirror of the Foundry
   * test's privilege assertions). Requires a `publicClient`.
   *
   * @param key Address to query in the account's `privileges` mapping.
   * @returns The 32-byte privilege value (`0x..00` means not authorized).
   */
  async getPrivilege(key: Address): Promise<Hex> {
    if (!this.publicClient) {
      throw new Error('RecoveryClient.getPrivilege: no publicClient configured');
    }
    return this.publicClient.readContract({
      address: this.config.account,
      abi: AMBIRE_ACCOUNT_ABI,
      functionName: 'privileges',
      args: [key],
    });
  }
}
