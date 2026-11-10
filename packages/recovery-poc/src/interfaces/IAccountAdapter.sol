// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/// @title  IAccountAdapter
/// @author Kohaku
/// @notice The host-agnostic execution seam of the recovery kit. Given an
///         already-authorized request, an adapter makes a target smart account
///         execute a batch of calls ON ITS OWN BEHALF — WITHOUT the account owner
///         signing. Each host (Ambire, ERC-7579, Safe) provides exactly ONE
///         implementation of this interface; the recovery controller depends only
///         on this abstraction and never on host specifics.
/// @dev    This is the whole point of the Kohaku thesis: "recovery built once in the
///         SDK as 7579; the Ambire account reached via a thin adapter." Because the
///         controller holds only an `IAccountAdapter`, the identical controller drives
///         any account for which an adapter exists — swap host without recompiling the
///         policy layer.
///
///         Mirrors the ERC-7579 `executeFromExecutor` capability. The Ambire
///         implementation routes through `executeBySender`; a 7579 implementation
///         would route through `executeFromExecutor`; a Safe implementation through a
///         module call. The adapter performs ONLY the host-specific execution
///         mechanics — it holds no recovery policy and trusts its caller (the
///         controller) to have enforced policy.
interface IAccountAdapter {
    /// @notice One call in a batch. Field-compatible with Ambire's `Transaction`
    ///         struct and trivially mappable to an ERC-7579 execution, so adapters
    ///         translate to their host's native batch type with no semantic loss.
    struct Call {
        /// @notice Target of the call (often the account itself for self-calls
        ///         such as a privilege/owner rotation).
        address to;
        /// @notice Native value (wei) to forward with the call.
        uint256 value;
        /// @notice ABI-encoded calldata for the call.
        bytes data;
    }

    /// @notice Execute `calls` on `account`'s behalf, as an authorized executor.
    /// @dev    MUST revert if this adapter is not an authorized executor on
    ///         `account` (the host's own privilege/authorization check enforces
    ///         this — e.g. Ambire's `INSUFFICIENT_PRIVILEGE`). The caller
    ///         (controller) is responsible for recovery policy; the adapter only
    ///         performs the host-specific execution mechanics. Implementations
    ///         SHOULD restrict callers to their configured controller.
    /// @param  account The target smart account.
    /// @param  calls   The batch to execute on the account's behalf.
    function execute(address account, Call[] calldata calls) external;

    /// @notice Convenience helper for the canonical recovery action: grant signing
    ///         authority on `account` to `newOwner`.
    /// @dev    Implementations encode this intent into their host's native authority
    ///         model (Ambire: a self-call to `setAddrPrivilege(newOwner, 1)`; 7579: a
    ///         validator/owner-module update) and route it through `execute`.
    ///         Implementations MUST NOT revoke their own executor authority while
    ///         doing so, to respect host anti-bricking checks (e.g. Ambire re-checks
    ///         the caller's privilege after the batch).
    /// @param  account  The target smart account.
    /// @param  newOwner The address to grant signing authority to.
    function rotateSigner(address account, address newOwner) external;
}
