// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC7579Account} from "./interfaces/IERC7579Account.sol";
import {IRecoveryMethod} from "./interfaces/IRecoveryMethod.sol";
import {ERC7579Mode} from "./lib/ERC7579Mode.sol";

/// @title  RecoveryController (recovery v0)
/// @author Kohaku
/// @notice The policy + orchestration layer of the recovery kit. It (1) holds the
///         recovery policy, (2) verifies a presented proof against the configured
///         recovery method, and (3) rotates the account's signer by calling the REAL
///         ERC-7579 executor primitive {IERC7579Account.executeFromExecutor} on the
///         configured target.
/// @dev    v0 EVOLUTION OF THE PoC. The prior `RecoveryControllerPoC` drove the account
///         through a CUSTOM `IAccountAdapter.rotateSigner` seam. This controller instead
///         speaks REAL ERC-7579: its only account-facing dependency is the standard
///         {IERC7579Account} interface, and it rotates by emitting a single ERC-7579
///         execution (`executeFromExecutor(MODE_SINGLE_DEFAULT, encodeSingle(...))`).
///
///         HOST-AGNOSTIC BY CONSTRUCTION. The controller imports ONLY two interfaces
///         ({IERC7579Account}, {IRecoveryMethod}) and one pure encoding library — never
///         an Ambire (or any other host) type. The SAME controller binary drives:
///           - a native {Minimal7579Account} (real installModule/executeFromExecutor), and
///           - the Ambire account via {AmbireExecutorAdapter}, which IS-A
///             {IERC7579Account} and translates the executor call into Ambire's
///             `executeBySender`.
///         The controller never branches on host; both targets implement the same
///         interface. `target` is bound at construction (immutable) for v0 clarity; a
///         production controller could resolve a target per call.
///
///         POLICY IS A v0 PLACEHOLDER. The policy here is deliberately trivial: a
///         single method and ~zero timelock. The real, audit-gated piece is an
///         OR-over-AND combinator with per-method timelocks and thresholds. That
///         combinator replaces the trivial verify step in {initiateRecovery} WITHOUT
///         touching {IERC7579Account} or {IRecoveryMethod}. v0 proves the END-TO-END
///         path (GUI -> controller -> real 7579 executeFromExecutor -> account
///         rotation), NOT the combinator.
contract RecoveryController {
    // ---------------------------------------------------------------------
    // Immutable wiring (host-agnostic; no hardcoded addresses — passed in)
    // ---------------------------------------------------------------------

    /// @notice The ERC-7579 executor surface this controller drives. For the native
    ///         demo this is a {Minimal7579Account}; for the Ambire demo it is an
    ///         {AmbireExecutorAdapter} wrapping a real Ambire account. The controller
    ///         only ever sees {IERC7579Account}.
    IERC7579Account public immutable target;

    /// @notice The single recovery method consulted by the trivial policy. The real
    ///         combinator replaces this single reference with a set of methods.
    IRecoveryMethod public immutable method;

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice The canonical owner-rotation selector this controller emits. The native
    ///         account exposes `rotateOwner(address)` and honors it literally; the
    ///         Ambire adapter recognizes this selector and re-maps the intent onto
    ///         Ambire's `setAddrPrivilege(newOwner, 1)`. Keeping a single canonical
    ///         intent selector is what lets the native account and the off-chain SDK
    ///         agree on the wire format.
    bytes4 public constant ROTATE_OWNER_SELECTOR = bytes4(keccak256("rotateOwner(address)"));

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    /// @notice Per-target recovery nonce, incremented on every successful recovery.
    ///         Bound into `recoveryHash` so a proof for request N cannot be replayed
    ///         for request N+1 (replay protection). Keyed by target so the mapping
    ///         shape is stable even though `target` is fixed per deployment.
    mapping(address => uint256) public recoveryNonce;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @notice Emitted when a recovery successfully rotates `target`'s signer.
    /// @param target       The recovered account / executor surface.
    /// @param newOwner     The address granted signing authority.
    /// @param recoveryHash The action commitment that was authorized.
    /// @param usedNonce    The per-target nonce consumed by this recovery.
    event RecoveryExecuted(
        address indexed target,
        address indexed newOwner,
        bytes32 recoveryHash,
        uint256 usedNonce
    );

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

    /// @param _target The ERC-7579 executor surface to drive (native account OR Ambire
    ///                adapter). Bound immutably for v0.
    /// @param _method The recovery method consulted by the trivial policy.
    constructor(IERC7579Account _target, IRecoveryMethod _method) {
        if (address(_target) == address(0) || address(_method) == address(0)) {
            revert ZeroAddress();
        }
        target = _target;
        method = _method;
    }

    // ---------------------------------------------------------------------
    // Recovery
    // ---------------------------------------------------------------------

    /// @notice Initiate (and, under the trivial v0 policy, immediately execute) a
    ///         recovery that rotates the configured target's signer to `newOwner`.
    /// @dev    Callable by ANYONE (e.g. a relayer): authorization comes from the method
    ///         proof, not from the caller. Flow:
    ///           1. Compute the action commitment from `(newOwner, recoveryNonce)`.
    ///           2. POLICY (v0: single method, ~0 timelock) — verify the proof.
    ///              <-- the real OR-over-AND combinator slots in HERE, returning the
    ///                  same boolean authorize/deny decision.
    ///           3. Consume the nonce (replay protection) BEFORE the external call.
    ///           4. Rotate via REAL ERC-7579 `executeFromExecutor` (single+default mode).
    ///         Step 3 precedes step 4 (checks-effects-interactions) so the nonce is
    ///         burned even across the external call.
    ///
    ///         The execution is a single call `target.rotateOwner(newOwner)`. On the
    ///         native account that literally rotates `owner`; on the Ambire adapter the
    ///         adapter re-interprets the rotation intent into Ambire's authority model.
    /// @param  newOwner The address to grant signing authority to.
    /// @param  proof    Method-specific evidence (empty for v0's AlwaysValidMethod).
    function initiateRecovery(address newOwner, bytes calldata proof) external {
        if (newOwner == address(0)) revert ZeroAddress();

        address account = address(target);
        uint256 usedNonce = recoveryNonce[account];
        bytes32 recoveryHash = _recoveryHash(account, newOwner, usedNonce);

        // --- POLICY (v0 placeholder: single method, no timelock) ---
        // The real combinator replaces this single check with an OR-over-AND
        // evaluation over many methods, without changing this call's contract.
        if (!method.verify(account, recoveryHash, proof)) revert MethodRejected();

        // Effects before interactions: burn the nonce so a replay of `proof`
        // cannot drive a second rotation.
        recoveryNonce[account] = usedNonce + 1;

        // Interaction: rotate via the REAL ERC-7579 executor primitive. Build the
        // single-call execution `account.rotateOwner(newOwner)` and route it through
        // executeFromExecutor in single + default mode.
        bytes memory rotateCall = abi.encodeWithSelector(ROTATE_OWNER_SELECTOR, newOwner);
        bytes memory execData = ERC7579Mode.encodeSingle(account, 0, rotateCall);
        target.executeFromExecutor(ERC7579Mode.MODE_SINGLE_DEFAULT, execData);

        emit RecoveryExecuted(account, newOwner, recoveryHash, usedNonce);
    }

    // ---------------------------------------------------------------------
    // Views / helpers
    // ---------------------------------------------------------------------

    /// @notice Compute the action commitment for the NEXT recovery to `newOwner`, using
    ///         the target's current nonce. Useful off-chain for a method to know
    ///         exactly what hash a proof must authorize.
    /// @param  newOwner The proposed new signer.
    /// @return The `recoveryHash` that {initiateRecovery} will verify against next.
    function pendingRecoveryHash(address newOwner) external view returns (bytes32) {
        address account = address(target);
        return _recoveryHash(account, newOwner, recoveryNonce[account]);
    }

    /// @dev Action commitment binds the new owner and the per-target nonce (replay
    ///      protection). `address(this)` and `block.chainid` are folded in to bind the
    ///      commitment to this controller deployment and chain. Encoding preserved from
    ///      the PoC so the off-chain SDK (`controllerBound` scheme) stays a faithful
    ///      twin.
    function _recoveryHash(
        address account,
        address newOwner,
        uint256 nonce
    ) internal view returns (bytes32) {
        return keccak256(abi.encode(address(this), block.chainid, account, newOwner, nonce));
    }
}
