// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IAccountAdapter} from "./interfaces/IAccountAdapter.sol";
import {IRecoveryMethod} from "./interfaces/IRecoveryMethod.sol";

/// @title  RecoveryControllerPoC
/// @author Kohaku
/// @notice The policy + orchestration layer of the recovery kit, for the PoC.
///         It (1) holds the recovery policy, (2) verifies a presented proof against
///         the configured recovery method, and (3) asks the configured account
///         adapter to perform the signer rotation on the target account.
/// @dev    HOST-AGNOSTIC BY CONSTRUCTION. This contract imports ONLY the two
///         interfaces (`IAccountAdapter`, `IRecoveryMethod`) — never an Ambire (or any
///         other host) type. The identical controller drives any account for which an
///         `IAccountAdapter` implementation exists.
///
///         POLICY IS A POC PLACEHOLDER. The policy here is deliberately trivial:
///         a single method and ~zero timelock. The real, audit-gated piece is an
///         OR-over-AND combinator with per-method timelocks and thresholds. That
///         combinator replaces the trivial core in {initiateRecovery} (the verify
///         step) WITHOUT touching `IAccountAdapter` or `IRecoveryMethod`. The
///         {cancelRecovery} owner-priority hook is likewise a stub for where the real
///         pending-request + veto-window machinery will live.
///
///         This PoC proves the ADAPTER / EXECUTION seam against the real Ambire
///         account — it does NOT prove the combinator.
contract RecoveryControllerPoC {
    // ---------------------------------------------------------------------
    // Immutable wiring (host-agnostic; no hardcoded addresses — passed in)
    // ---------------------------------------------------------------------

    /// @notice The execution seam used to drive the target account. The PoC binds one
    ///         adapter; a production controller may resolve an adapter per account.
    IAccountAdapter public immutable adapter;

    /// @notice The single recovery method consulted by the trivial policy. The real
    ///         combinator replaces this single reference with a set of methods.
    IRecoveryMethod public immutable method;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    /// @notice Per-account recovery nonce, incremented on every successful recovery.
    ///         Bound into `recoveryHash` so a proof for request N cannot be replayed
    ///         for request N+1 (replay protection).
    mapping(address => uint256) public recoveryNonce;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @notice Emitted when a recovery successfully rotates `account`'s signer.
    /// @param account      The recovered account.
    /// @param newOwner     The address granted signing authority.
    /// @param recoveryHash The action commitment that was authorized.
    /// @param usedNonce    The per-account nonce consumed by this recovery.
    event RecoveryExecuted(
        address indexed account,
        address indexed newOwner,
        bytes32 recoveryHash,
        uint256 usedNonce
    );

    /// @notice Emitted by the owner-priority cancel hook (PoC stub).
    /// @param account     The account whose pending recovery window was vetoed.
    /// @param canceledBy  The caller that invoked the cancel.
    /// @param atNonce     The account's recovery nonce at cancel time.
    event RecoveryCanceled(address indexed account, address indexed canceledBy, uint256 atNonce);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    /// @notice Thrown when an address argument that must be non-zero is zero.
    error ZeroAddress();

    /// @notice Thrown when the configured method does not authorize the request.
    error MethodRejected();

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    /// @param _adapter The host-specific execution seam (e.g. an `AmbireAccountAdapter`).
    /// @param _method  The recovery method consulted by the trivial policy.
    constructor(IAccountAdapter _adapter, IRecoveryMethod _method) {
        if (address(_adapter) == address(0) || address(_method) == address(0)) {
            revert ZeroAddress();
        }
        adapter = _adapter;
        method = _method;
    }

    // ---------------------------------------------------------------------
    // Recovery
    // ---------------------------------------------------------------------

    /// @notice Initiate (and, under the trivial PoC policy, immediately execute) a
    ///         recovery that rotates `account`'s signer to `newOwner`.
    /// @dev    Callable by ANYONE (e.g. a relayer): authorization comes from the
    ///         method proof, not from the caller. Flow:
    ///           1. Compute the action commitment from `(newOwner, recoveryNonce)`.
    ///           2. POLICY (PoC: single method, ~0 timelock) — verify the proof.
    ///              <-- the real OR-over-AND combinator slots in HERE, returning the
    ///                  same boolean authorize/deny decision.
    ///           3. Consume the nonce (replay protection) BEFORE the external call.
    ///           4. Ask the adapter to rotate the signer on the account's behalf.
    ///         Step 3 precedes step 4 so the nonce is burned even across the external
    ///         adapter call (checks-effects-interactions).
    /// @param  account  The target smart account to recover.
    /// @param  newOwner The address to grant signing authority to.
    /// @param  proof    Method-specific evidence (empty for the PoC's AlwaysValidMethod).
    function initiateRecovery(
        address account,
        address newOwner,
        bytes calldata proof
    ) external {
        if (account == address(0) || newOwner == address(0)) revert ZeroAddress();

        uint256 usedNonce = recoveryNonce[account];
        bytes32 recoveryHash = _recoveryHash(account, newOwner, usedNonce);

        // --- POLICY (PoC placeholder: single method, no timelock) ---
        // The real combinator replaces this single check with an OR-over-AND
        // evaluation over many methods, without changing this call's contract.
        if (!method.verify(account, recoveryHash, proof)) revert MethodRejected();

        // Effects before interactions: burn the nonce so a replay of `proof`
        // cannot drive a second rotation.
        recoveryNonce[account] = usedNonce + 1;

        // Interaction: the adapter performs the host-specific rotation mechanics.
        adapter.rotateSigner(account, newOwner);

        emit RecoveryExecuted(account, newOwner, recoveryHash, usedNonce);
    }

    /// @notice Owner-priority cancel hook — PoC STUB.
    /// @dev    In the real kit this lets the legitimate owner veto a pending recovery
    ///         within its timelock window (owner action takes priority over a
    ///         not-yet-finalized recovery). The trivial PoC policy finalizes
    ///         immediately, so there is no pending window to cancel; this stub only
    ///         bumps the nonce to invalidate any in-flight proof and emits an event,
    ///         marking the seam where the real veto machinery lands. It performs no
    ///         host-specific calls and never touches the adapter.
    /// @param  account The account whose in-flight recovery proof should be invalidated.
    function cancelRecovery(address account) external {
        if (account == address(0)) revert ZeroAddress();
        uint256 atNonce = recoveryNonce[account];
        // Invalidate any proof bound to the current nonce.
        recoveryNonce[account] = atNonce + 1;
        emit RecoveryCanceled(account, msg.sender, atNonce);
    }

    // ---------------------------------------------------------------------
    // Views / helpers
    // ---------------------------------------------------------------------

    /// @notice Compute the action commitment for the NEXT recovery of `account` to
    ///         `newOwner`, using the account's current nonce. Useful off-chain for a
    ///         method to know exactly what hash a proof must authorize.
    /// @param  account  The target account.
    /// @param  newOwner The proposed new signer.
    /// @return The `recoveryHash` that {initiateRecovery} will verify against next.
    function pendingRecoveryHash(address account, address newOwner) external view returns (bytes32) {
        return _recoveryHash(account, newOwner, recoveryNonce[account]);
    }

    /// @dev Action commitment binds the new owner and the per-account nonce (replay
    ///      protection). `address(this)` and `block.chainid` are folded in to bind the
    ///      commitment to this controller deployment and chain.
    function _recoveryHash(
        address account,
        address newOwner,
        uint256 nonce
    ) internal view returns (bytes32) {
        return keccak256(abi.encode(address(this), block.chainid, account, newOwner, nonce));
    }
}
