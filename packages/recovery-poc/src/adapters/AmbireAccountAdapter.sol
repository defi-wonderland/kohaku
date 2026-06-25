// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IAccountAdapter} from "../interfaces/IAccountAdapter.sol";

/// @title  IAmbireAccount (minimal)
/// @notice The minimal slice of the Ambire smart-account ABI this adapter needs.
/// @dev    Declared locally on purpose: the adapter must NOT depend on the full
///         `AmbireAccount` implementation (or its library tree). It only needs the
///         executor primitive (`executeBySender`), the rotation primitive
///         (`setAddrPrivilege`, which the account self-calls inside the batch), and
///         the privilege getter (used for read-only assertions / introspection).
///         `Transaction` is field-identical to Ambire's
///         `struct Transaction { address to; uint256 value; bytes data; }`
///         (contracts/libs/Transaction.sol), so the ABI encoding matches the real
///         account byte-for-byte.
interface IAmbireAccount {
    /// @notice Ambire's batch element. A better name would be `Call`; kept as
    ///         `Transaction` for ABI compatibility with the deployed account.
    struct Transaction {
        address to;
        uint256 value;
        bytes data;
    }

    /// @notice Execute `calls` if `msg.sender` holds a non-zero privilege on the
    ///         account. No signature, no nonce — the caller IS the authorization.
    ///         This is Ambire's analogue of ERC-7579 `executeFromExecutor`.
    /// @dev    Reverts `INSUFFICIENT_PRIVILEGE` if the caller is not privileged, and
    ///         re-checks the caller's privilege AFTER the batch (anti-bricking:
    ///         `PRIVILEGE_NOT_DOWNGRADED`).
    function executeBySender(Transaction[] calldata calls) external payable;

    /// @notice Set the privilege value for `addr`. Self-call only
    ///         (`require(msg.sender == address(this))`), so it is reachable only as
    ///         an element of a batch the account executes on its own behalf.
    function setAddrPrivilege(address addr, bytes32 priv) external payable;

    /// @notice Read the privilege value for `key` (non-zero == authorized signer).
    function privileges(address key) external view returns (bytes32);
}

/// @title  AmbireAccountAdapter
/// @author Kohaku
/// @notice The Ambire implementation of {IAccountAdapter}. It translates the
///         host-agnostic `Call[]` batch into Ambire's native `Transaction[]` and
///         drives the target account through `executeBySender` — the exact
///         executor primitive Ambire exposes (its analogue of ERC-7579
///         `executeFromExecutor`). For the canonical recovery action it builds a
///         one-element batch that self-calls `setAddrPrivilege(newOwner, 1)` on the
///         account.
/// @dev    THIN TRANSLATION LAYER — HOLDS NO RECOVERY OR POLICY LOGIC. The adapter
///         neither verifies proofs nor enforces thresholds/timelocks; that is the
///         controller's job (and, in production, the audit-gated combinator's). The
///         adapter's only responsibilities are:
///           (1) restrict callers to the configured controller, and
///           (2) map the interface batch onto Ambire's `executeBySender`.
///
///         AUTHORIZATION MODEL. The adapter carries NO privilege state of its own;
///         the account is the single source of truth. For `executeBySender` to
///         succeed, THIS adapter's address must already sit in the account's
///         `privileges` mapping. That one-time grant is performed during onboarding
///         by the account owner (the owner wraps `setAddrPrivilege(adapter, 1)` in
///         its own `execute`/`executeBySender`); it is the ONLY owner-signed step in
///         the whole flow and is NOT part of recovery. If the adapter was never
///         granted, `executeBySender` reverts `INSUFFICIENT_PRIVILEGE` and the
///         rotation cannot happen — the account must opt in.
///
///         ANTI-BRICKING. Ambire re-checks the caller's (this adapter's) privilege
///         AFTER the batch. The rotation batch therefore only GRANTS the new owner
///         and never touches the adapter's own privilege, so the post-batch check
///         passes. {execute} forwards arbitrary batches verbatim, so a caller is
///         responsible for not constructing a batch that would self-revoke the
///         adapter; {rotateSigner} is safe by construction.
contract AmbireAccountAdapter is IAccountAdapter {
    /// @notice The privilege value granted to a normal authorized signer on Ambire
    ///         (`bytes32(uint256(1))` — any non-zero value authorizes the key).
    bytes32 internal constant PRIV_LEVEL_AUTHORIZED = bytes32(uint256(1));

    /// @notice The only address permitted to invoke this adapter. Set once at
    ///         construction; passed in (no hardcoded addresses in source).
    address public immutable controller;

    /// @notice Thrown when the constructor is given the zero address as controller.
    error ZeroController();

    /// @notice Thrown when a caller other than {controller} invokes a guarded method.
    error NotController();

    /// @notice Restricts a function to the configured controller. The adapter trusts
    ///         the controller to have enforced recovery policy before calling.
    modifier onlyController() {
        if (msg.sender != controller) revert NotController();
        _;
    }

    /// @param _controller The recovery controller allowed to drive this adapter.
    constructor(address _controller) {
        if (_controller == address(0)) revert ZeroController();
        controller = _controller;
    }

    /// @inheritdoc IAccountAdapter
    /// @dev Maps each {IAccountAdapter.Call} to an Ambire `Transaction` (the structs
    ///      are field-identical) and forwards the batch via `executeBySender`. Reverts
    ///      with Ambire's own error (`INSUFFICIENT_PRIVILEGE`) if this adapter is not a
    ///      privileged executor on `account`. No value is forwarded by the adapter
    ///      itself; per-call `value` rides inside each `Transaction`.
    function execute(address account, Call[] calldata calls) external override onlyController {
        uint256 len = calls.length;
        IAmbireAccount.Transaction[] memory txns = new IAmbireAccount.Transaction[](len);
        for (uint256 i = 0; i < len; i++) {
            txns[i] = IAmbireAccount.Transaction({
                to: calls[i].to,
                value: calls[i].value,
                data: calls[i].data
            });
        }
        IAmbireAccount(payable(account)).executeBySender(txns);
    }

    /// @inheritdoc IAccountAdapter
    /// @dev Builds the canonical single-call rotation batch: the account self-calls
    ///      `setAddrPrivilege(newOwner, 1)`. The `to` is the account itself, which is
    ///      what satisfies Ambire's `setAddrPrivilege` self-call guard once the call
    ///      runs inside `executeBatch`. This is purely ADDITIVE — it grants `newOwner`
    ///      and never alters the adapter's own privilege, so Ambire's post-batch
    ///      anti-bricking check on the caller (this adapter) still passes.
    ///
    ///      NOTE ON SEMANTICS: this grants the new owner without revoking the old key.
    ///      That matches the recovery primitive being proven (regain control via a new
    ///      key). Revoking the prior signer is a separate, policy-driven batch the
    ///      controller can route through {execute}; it is intentionally out of scope
    ///      for this thin adapter helper.
    function rotateSigner(address account, address newOwner) external override onlyController {
        IAmbireAccount.Transaction[] memory txns = new IAmbireAccount.Transaction[](1);
        txns[0] = IAmbireAccount.Transaction({
            to: account,
            value: 0,
            data: abi.encodeWithSelector(
                IAmbireAccount.setAddrPrivilege.selector,
                newOwner,
                PRIV_LEVEL_AUTHORIZED
            )
        });
        IAmbireAccount(payable(account)).executeBySender(txns);
    }
}
