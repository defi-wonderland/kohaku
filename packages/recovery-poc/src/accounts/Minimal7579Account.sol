// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC7579Account} from "../interfaces/IERC7579Account.sol";
import {ERC7579Mode} from "../lib/ERC7579Mode.sol";

/// @title  Minimal7579Account
/// @author Kohaku
/// @notice A minimal ERC-7579 reference smart account — the NATIVE recovery target. It
///         implements real {installModule} (executor type) and {executeFromExecutor},
///         storing a single rotatable `owner`. The recovery controller is installed as
///         an executor module and rotates `owner` through the standard 7579 executor
///         path, with no owner signature.
/// @dev    SCOPE: this is a faithful-but-minimal account for the v0 demo, NOT a full
///         ERC-7579 implementation. It supports exactly what the recovery flow needs:
///           - install an EXECUTOR (moduleTypeId == 2) module, gated to the owner;
///           - {executeFromExecutor} callable ONLY by an installed executor, in
///             SINGLE + DEFAULT mode, decoding one call;
///           - {rotateOwner}, a self-targeted owner rotation reachable only via
///             {executeFromExecutor} (so recovery rotates the signer the same way a
///             real 7579 executor module would).
///         Validators, hooks, fallbacks, batch/try/delegatecall modes, and generic
///         self-calls beyond the rotation path are intentionally out of scope for v0.
contract Minimal7579Account is IERC7579Account {
    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice ERC-7579 module type id for executor modules.
    uint256 internal constant MODULE_TYPE_EXECUTOR = 2;

    /// @notice The canonical owner-rotation selector the controller emits and this
    ///         account honors literally. Must equal
    ///         {RecoveryController.ROTATE_OWNER_SELECTOR} =
    ///         `bytes4(keccak256("rotateOwner(address)"))`.
    bytes4 internal constant ROTATE_OWNER_SELECTOR = bytes4(keccak256("rotateOwner(address)"));

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    /// @notice The rotatable signer. Recovery installs a new value here.
    address public owner;

    /// @notice Installed-module registry: moduleTypeId => module => installed.
    mapping(uint256 => mapping(address => bool)) public modules;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @notice Emitted when the account's signer is rotated.
    /// @param previousOwner The signer before rotation.
    /// @param newOwner      The signer after rotation.
    event OwnerRotated(address indexed previousOwner, address indexed newOwner);

    /// @notice Emitted when a module is installed.
    /// @param moduleTypeId The ERC-7579 module type (v0: 2 = executor).
    /// @param module       The installed module address.
    event ModuleInstalled(uint256 indexed moduleTypeId, address indexed module);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    /// @notice Thrown when an owner-gated call is made by a non-owner.
    error NotOwner();

    /// @notice Thrown when {executeFromExecutor} is called by an address that is not an
    ///         installed executor module.
    error NotInstalledExecutor();

    /// @notice Thrown when a module type other than executor (2) is used in v0.
    error UnsupportedModuleType();

    /// @notice Thrown when an unsupported ERC-7579 ModeCode is supplied.
    error UnsupportedMode();

    /// @notice Thrown when the self-rotation guard is violated (caller != self).
    error OnlySelf();

    /// @notice Thrown when an address argument that must be non-zero is zero.
    error ZeroAddress();

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    /// @param initialOwner The seed signer (the deploy harness passes the demo owner).
    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
        emit OwnerRotated(address(0), initialOwner);
    }

    // ---------------------------------------------------------------------
    // Module management (ERC-7579)
    // ---------------------------------------------------------------------

    /// @inheritdoc IERC7579Account
    /// @dev v0: only the owner may install, and only executor (type 2) is supported.
    ///      `initData` is unused in v0.
    function installModule(
        uint256 moduleTypeId,
        address module,
        bytes calldata /* initData */
    ) external override {
        if (msg.sender != owner) revert NotOwner();
        if (moduleTypeId != MODULE_TYPE_EXECUTOR) revert UnsupportedModuleType();
        if (module == address(0)) revert ZeroAddress();
        modules[moduleTypeId][module] = true;
        emit ModuleInstalled(moduleTypeId, module);
    }

    /// @inheritdoc IERC7579Account
    function isModuleInstalled(
        uint256 moduleTypeId,
        address module,
        bytes calldata /* additionalContext */
    ) external view override returns (bool installed) {
        return modules[moduleTypeId][module];
    }

    // ---------------------------------------------------------------------
    // Execution (ERC-7579 executor entrypoint)
    // ---------------------------------------------------------------------

    /// @inheritdoc IERC7579Account
    /// @dev Callable ONLY by an installed executor module. v0 supports only the
    ///      single + default mode; the decoded call must target this account with the
    ///      {ROTATE_OWNER_SELECTOR}. The account performs the rotation via an internal
    ///      self-call to {rotateOwner}, faithfully modeling a real 7579 executor
    ///      driving a self-targeted account function. Generic self-calls are out of
    ///      scope for v0.
    function executeFromExecutor(
        bytes32 mode,
        bytes calldata executionCalldata
    ) external payable override returns (bytes[] memory returnData) {
        if (!modules[MODULE_TYPE_EXECUTOR][msg.sender]) revert NotInstalledExecutor();
        if (mode != ERC7579Mode.MODE_SINGLE_DEFAULT) revert UnsupportedMode();

        (address to, , bytes calldata callData) = ERC7579Mode.decodeSingle(executionCalldata);

        // v0 only routes the rotation intent. The call must target this account and
        // carry the canonical rotate selector.
        if (to != address(this)) revert UnsupportedMode();
        if (callData.length < 4 || bytes4(callData[0:4]) != ROTATE_OWNER_SELECTOR) {
            revert UnsupportedMode();
        }

        // Self-call the public rotation function so its self-call guard is satisfied
        // exactly as a real on-chain execution would satisfy it.
        (bool ok, bytes memory ret) = address(this).call(callData);
        require(ok, "Minimal7579Account: rotate failed");

        returnData = new bytes[](1);
        returnData[0] = ret;
    }

    // ---------------------------------------------------------------------
    // Owner rotation (self-call only)
    // ---------------------------------------------------------------------

    /// @notice Rotate the account's signer to `newOwner`.
    /// @dev    Reachable ONLY via {executeFromExecutor} (self-call): the guard requires
    ///         `msg.sender == address(this)`. This mirrors how a real 7579 account
    ///         exposes self-targeted admin functions to executor modules without making
    ///         them externally callable.
    /// @param  newOwner The address to install as the new signer.
    function rotateOwner(address newOwner) external {
        if (msg.sender != address(this)) revert OnlySelf();
        if (newOwner == address(0)) revert ZeroAddress();
        address previous = owner;
        owner = newOwner;
        emit OwnerRotated(previous, newOwner);
    }
}
