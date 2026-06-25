// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC7579Account} from "../interfaces/IERC7579Account.sol";
import {ERC7579Mode} from "../lib/ERC7579Mode.sol";

/// @title  IAmbireAccount (minimal)
/// @notice The minimal slice of the Ambire smart-account ABI this adapter needs.
/// @dev    Declared locally on purpose: the adapter must NOT depend on the full
///         `AmbireAccount` implementation (or its library tree). It only needs the
///         executor primitive (`executeBySender`), the rotation primitive
///         (`setAddrPrivilege`, which the account self-calls inside the batch), and the
///         privilege getter (used for read-only introspection). `Transaction` is
///         field-identical to Ambire's
///         `struct Transaction { address to; uint256 value; bytes data; }`
///         (contracts/libs/Transaction.sol), so the ABI encoding matches the real
///         account byte-for-byte.
interface IAmbireAccount {
    /// @notice Ambire's batch element. Field-identical to the ERC-7579 single
    ///         (to,value,data) tuple, so translation is lossless.
    struct Transaction {
        address to;
        uint256 value;
        bytes data;
    }

    /// @notice Execute `calls` if `msg.sender` holds a non-zero privilege. No signature,
    ///         no nonce — the caller IS the authorization. Ambire's analogue of
    ///         ERC-7579 `executeFromExecutor`. Reverts `INSUFFICIENT_PRIVILEGE` if the
    ///         caller is unprivileged and re-checks privilege AFTER the batch
    ///         (anti-bricking: `PRIVILEGE_NOT_DOWNGRADED`).
    function executeBySender(Transaction[] calldata calls) external payable;

    /// @notice Set the privilege value for `addr`. Self-call only on the account
    ///         (`msg.sender == address(this)`), so it is reachable only as a batch
    ///         element the account executes on its own behalf.
    function setAddrPrivilege(address addr, bytes32 priv) external payable;

    /// @notice Read the privilege value for `key` (non-zero == authorized signer).
    function privileges(address key) external view returns (bytes32);
}

/// @title  AmbireExecutorAdapter (recovery v0)
/// @author Kohaku
/// @notice The Ambire recovery target, expressed as a REAL ERC-7579 executor surface.
///         The adapter IS-A {IERC7579Account}: it implements {executeFromExecutor} and
///         translates the ERC-7579 single-call rotation intent into Ambire's native
///         `executeBySender([ setAddrPrivilege(newOwner, 1) ])`. This is what lets the
///         SAME {RecoveryController} binary drive the Ambire account without ever
///         referencing an Ambire type.
/// @dev    THIN TRANSLATION LAYER — HOLDS NO RECOVERY OR POLICY LOGIC. The adapter
///         neither verifies proofs nor enforces thresholds/timelocks; that is the
///         controller's job (and, in production, the audit-gated combinator's). Its only
///         responsibilities are:
///           (1) restrict {executeFromExecutor} callers to the configured controller,
///           (2) accept only the v0 mode (single + default),
///           (3) re-interpret the canonical `rotateOwner(address)` intent into Ambire's
///               authority model (`setAddrPrivilege(newOwner, 1)`), and
///           (4) route the resulting one-call batch through `executeBySender`.
///
///         WHY THE ADAPTER RE-INTERPRETS INTENT. The native account honors
///         `rotateOwner(address)` literally; Ambire has no such function — its authority
///         model is the `privileges` mapping. The adapter is the host translation layer,
///         so it is allowed to map the canonical rotation intent onto Ambire's
///         primitive. It still holds NO policy: it grants exactly the `newOwner` the
///         controller authorized and nothing else.
///
///         AUTHORIZATION MODEL. The adapter carries no privilege state of its own; the
///         Ambire account is the single source of truth. For `executeBySender` to
///         succeed, THIS adapter's address must already sit in the account's
///         `privileges` mapping. That one-time grant is performed during onboarding by
///         the account owner (`executeBySender([setAddrPrivilege(adapter, 1)])`); it is
///         the ONLY owner-signed step in the whole flow and is NOT part of recovery. If
///         the adapter was never granted, `executeBySender` reverts
///         `INSUFFICIENT_PRIVILEGE` and the rotation cannot happen.
///
///         ANTI-BRICKING. Ambire re-checks the caller's (this adapter's) privilege AFTER
///         the batch. The rotation batch only GRANTS `newOwner` and never touches the
///         adapter's own privilege, so the post-batch check passes by construction.
contract AmbireExecutorAdapter is IERC7579Account {
    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice The privilege value granted to a normal authorized Ambire key
    ///         (`bytes32(uint256(1))` — any non-zero value authorizes the key).
    bytes32 internal constant PRIV_AUTHORIZED = bytes32(uint256(1));

    /// @notice ERC-7579 module type id for executor modules (parity with the native
    ///         account's install surface).
    uint256 internal constant MODULE_TYPE_EXECUTOR = 2;

    /// @notice The canonical owner-rotation selector the controller emits. Must equal
    ///         {RecoveryController.ROTATE_OWNER_SELECTOR}.
    bytes4 internal constant ROTATE_OWNER_SELECTOR = bytes4(keccak256("rotateOwner(address)"));

    // ---------------------------------------------------------------------
    // Immutable wiring (no hardcoded addresses — passed in)
    // ---------------------------------------------------------------------

    /// @notice The real Ambire account being wrapped / recovered.
    address public immutable ambireAccount;

    /// @notice The only caller permitted to invoke {executeFromExecutor}. The adapter
    ///         trusts the controller to have enforced recovery policy before calling.
    address public immutable controller;

    // ---------------------------------------------------------------------
    // State (introspection parity only)
    // ---------------------------------------------------------------------

    /// @notice Records modules whose installation intent was registered through this
    ///         adapter, purely for {isModuleInstalled} introspection parity with the
    ///         native account. Ambire authority lives in the account's `privileges`
    ///         mapping, not here.
    mapping(uint256 => mapping(address => bool)) internal _installedModules;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @notice Emitted for install-surface parity with the native account.
    /// @param moduleTypeId The ERC-7579 module type.
    /// @param module       The module address recorded as installed.
    event ModuleInstalled(uint256 indexed moduleTypeId, address indexed module);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    /// @notice Thrown when a constructor argument that must be non-zero is zero.
    error ZeroAddress();

    /// @notice Thrown when {executeFromExecutor} is called by anyone but {controller}.
    error NotController();

    /// @notice Thrown when an unsupported ERC-7579 ModeCode is supplied.
    error UnsupportedMode();

    /// @notice Thrown when the decoded execution is not the canonical rotation intent.
    error UnsupportedIntent();

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    /// @param _ambireAccount The deployed Ambire account this adapter wraps.
    /// @param _controller    The {RecoveryController} allowed to drive this adapter.
    constructor(address _ambireAccount, address _controller) {
        if (_ambireAccount == address(0) || _controller == address(0)) revert ZeroAddress();
        ambireAccount = _ambireAccount;
        controller = _controller;
    }

    // ---------------------------------------------------------------------
    // Module management (ERC-7579 parity surface)
    // ---------------------------------------------------------------------

    /// @inheritdoc IERC7579Account
    /// @dev v0 NO-OP install surface for parity. Ambire authority is the account's
    ///      `privileges` mapping; the adapter's privilege is granted out-of-band during
    ///      onboarding (owner -> executeBySender -> setAddrPrivilege(adapter, 1)). This
    ///      only records intent so {isModuleInstalled} can answer. `initData` unused.
    function installModule(
        uint256 moduleTypeId,
        address module,
        bytes calldata /* initData */
    ) external override {
        if (module == address(0)) revert ZeroAddress();
        _installedModules[moduleTypeId][module] = true;
        emit ModuleInstalled(moduleTypeId, module);
    }

    /// @inheritdoc IERC7579Account
    function isModuleInstalled(
        uint256 moduleTypeId,
        address module,
        bytes calldata /* additionalContext */
    ) external view override returns (bool installed) {
        return _installedModules[moduleTypeId][module];
    }

    // ---------------------------------------------------------------------
    // Execution (ERC-7579 executor entrypoint -> Ambire executeBySender)
    // ---------------------------------------------------------------------

    /// @inheritdoc IERC7579Account
    /// @dev ONLY {controller} may call. Accepts only the v0 mode (single + default),
    ///      decodes the single call, requires the canonical {ROTATE_OWNER_SELECTOR}
    ///      intent, extracts `newOwner`, and builds Ambire's
    ///      `setAddrPrivilege(newOwner, 1)` batch routed through `executeBySender`.
    ///      Reverts with Ambire's own `INSUFFICIENT_PRIVILEGE` if this adapter is not a
    ///      privileged executor on the account. Returns an empty array (Ambire's
    ///      `executeBySender` yields no return data).
    function executeFromExecutor(
        bytes32 mode,
        bytes calldata executionCalldata
    ) external payable override returns (bytes[] memory returnData) {
        if (msg.sender != controller) revert NotController();
        if (mode != ERC7579Mode.MODE_SINGLE_DEFAULT) revert UnsupportedMode();

        (, , bytes calldata callData) = ERC7579Mode.decodeSingle(executionCalldata);

        // Require the canonical rotation intent: rotateOwner(address newOwner).
        // Layout: 4-byte selector || 32-byte ABI-encoded address.
        if (callData.length < 36 || bytes4(callData[0:4]) != ROTATE_OWNER_SELECTOR) {
            revert UnsupportedIntent();
        }
        address newOwner = address(uint160(uint256(bytes32(callData[4:36]))));
        if (newOwner == address(0)) revert ZeroAddress();

        // Translate the rotation intent into Ambire's authority model: the account
        // self-calls setAddrPrivilege(newOwner, 1). `to = ambireAccount` is what
        // satisfies Ambire's setAddrPrivilege self-call guard once the call runs inside
        // executeBatch. Purely additive: never touches the adapter's own privilege, so
        // Ambire's post-batch anti-bricking check on the caller still passes.
        IAmbireAccount.Transaction[] memory txns = new IAmbireAccount.Transaction[](1);
        txns[0] = IAmbireAccount.Transaction({
            to: ambireAccount,
            value: 0,
            data: abi.encodeWithSelector(
                IAmbireAccount.setAddrPrivilege.selector,
                newOwner,
                PRIV_AUTHORIZED
            )
        });
        IAmbireAccount(payable(ambireAccount)).executeBySender(txns);

        return new bytes[](0);
    }
}
