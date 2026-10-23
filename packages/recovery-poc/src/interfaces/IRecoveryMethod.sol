// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/// @title  IRecoveryMethod
/// @author Kohaku
/// @notice A single recovery "leg" — verifies that a presented proof satisfies
///         this method for a given account + recovery request. Stateless and
///         host-agnostic: a method NEVER executes anything, it only attests.
/// @dev    Real methods (guardian-threshold, DKIM email, passkey, social) implement
///         this same shape so they slot into the controller / combinator unchanged.
///         The PoC ships `AlwaysValidMethod` as the trivial implementation.
///
///         This interface is intentionally minimal and Parti-shaped: a method is a
///         pure verifier over `(account, recoveryHash, proof)`. All policy
///         (thresholds, timelocks, OR-over-AND combination of methods) lives in the
///         controller / combinator above it, NOT here.
interface IRecoveryMethod {
    /// @notice Verify that `proof` authorizes the action committed to by
    ///         `recoveryHash` for `account`, under this method's rules.
    /// @dev    MUST be side-effect free (view). Binding the result to both
    ///         `account` and `recoveryHash` prevents a proof for one account /
    ///         request from being replayed against another.
    /// @param  account      The account being recovered (binds the proof to a target).
    /// @param  recoveryHash A commitment to the requested action (e.g. a hash of the
    ///                      new-owner rotation intent + per-account nonce). Opaque to
    ///                      the method beyond being the value it must authorize.
    /// @param  proof        Opaque, method-specific evidence (guardian sigs, DKIM
    ///                      blob, passkey assertion, etc.).
    /// @return ok           True iff this method authorizes `recoveryHash` for `account`.
    function verify(
        address account,
        bytes32 recoveryHash,
        bytes calldata proof
    ) external view returns (bool ok);
}
