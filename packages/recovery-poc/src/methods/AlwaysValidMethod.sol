// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IRecoveryMethod} from "../interfaces/IRecoveryMethod.sol";

/// @title  AlwaysValidMethod
/// @author Kohaku
/// @notice Trivial `IRecoveryMethod` that attests `true` for every request.
/// @dev    PoC PLACEHOLDER ONLY — NEVER deploy to production. Its sole purpose is to
///         let the test suite exercise the controller -> adapter execution path
///         without standing up real cryptography (guardian sigs, DKIM, passkeys).
///         A real method binds its decision to `(account, recoveryHash, proof)`; this
///         one ignores all three. The real OR-over-AND combinator and real methods
///         replace this WITHOUT touching `IAccountAdapter` or `RecoveryControllerPoC`.
contract AlwaysValidMethod is IRecoveryMethod {
    /// @inheritdoc IRecoveryMethod
    /// @dev Always returns true. Inputs are intentionally unused.
    function verify(
        address, /* account */
        bytes32, /* recoveryHash */
        bytes calldata /* proof */
    ) external pure override returns (bool ok) {
        return true;
    }
}
