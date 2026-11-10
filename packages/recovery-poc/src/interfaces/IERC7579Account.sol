// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/// @title  IERC7579Account (recovery-v0 subset)
/// @author Kohaku
/// @notice The minimal ERC-7579 "modular smart account" surface that the recovery kit
///         depends on: module installation/introspection plus the executor entrypoint
///         {executeFromExecutor}. This is the SINGLE seam the {RecoveryController}
///         talks to — it never references a host-specific (Ambire/Safe) type.
/// @dev    THE LOAD-BEARING IDEA OF v0. The controller's account-facing dependency is
///         this real ERC-7579 executor surface, NOT a custom adapter method. Anything
///         that implements this interface can be driven by the same controller binary:
///
///           - {Minimal7579Account} implements it NATIVELY (real installModule +
///             executeFromExecutor over its own storage), and
///           - {AmbireExecutorAdapter} IMPLEMENTS it as a translation shim that maps
///             {executeFromExecutor} onto Ambire's `executeBySender`.
///
///         So "one controller drives both targets" is literal: the controller is
///         configured with one `IERC7579Account target`; for the native demo that
///         target is the minimal account, for the Ambire demo it is the adapter.
///
///         This is a faithful SUBSET of ERC-7579, restricted to what v0 needs. The
///         module-type ids follow the standard (1=validator, 2=executor, 3=hook,
///         4=fallback); v0 only exercises type 2 (executor).
interface IERC7579Account {
    /// @notice Install a module of a given type onto the account.
    /// @dev    v0 installs the {RecoveryController} as an EXECUTOR (moduleTypeId == 2).
    ///         The standard module type ids are 1=validator, 2=executor, 3=hook,
    ///         4=fallback. Implementations decide who may install (the native account
    ///         restricts this to its owner).
    /// @param  moduleTypeId The ERC-7579 module type (v0 uses 2 = executor).
    /// @param  module       The module address (the recovery controller).
    /// @param  initData     Module-specific init payload (empty for v0).
    function installModule(uint256 moduleTypeId, address module, bytes calldata initData) external;

    /// @notice Report whether `module` of type `moduleTypeId` is installed.
    /// @param  moduleTypeId       The ERC-7579 module type.
    /// @param  module             The module address to query.
    /// @param  additionalContext  Module-type-specific context (unused in v0).
    /// @return installed          True iff the module is installed for that type.
    function isModuleInstalled(
        uint256 moduleTypeId,
        address module,
        bytes calldata additionalContext
    ) external view returns (bool installed);

    /// @notice Execute on the account's behalf, callable ONLY by an installed executor
    ///         module. This is the ERC-7579 primitive the recovery controller uses to
    ///         rotate the signer with no owner signature.
    /// @dev    `mode` is an ERC-7579 `ModeCode`; v0 only supports
    ///         {ERC7579Mode.MODE_SINGLE_DEFAULT} (single call, default exec type).
    ///         `executionCalldata` is the packed SINGLE execution
    ///         (`abi.encodePacked(address to, uint256 value, bytes callData)`).
    ///         Implementations MUST revert if the caller is not an installed executor.
    /// @param  mode              ERC-7579 ModeCode (v0: MODE_SINGLE_DEFAULT).
    /// @param  executionCalldata Packed execution payload (v0: single (to,value,data)).
    /// @return returnData        Per-call return data (one element for single mode).
    function executeFromExecutor(
        bytes32 mode,
        bytes calldata executionCalldata
    ) external payable returns (bytes[] memory returnData);
}
