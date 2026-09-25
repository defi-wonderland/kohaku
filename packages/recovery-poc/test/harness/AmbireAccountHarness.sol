// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import {AmbireAccount} from "ambire/AmbireAccount.sol";

/// @title  AmbireAccountHarness
/// @notice Test-only deployable wrapper around the REAL {AmbireAccount}.
/// @dev    `AmbireAccount` has NO constructor (see its line ~18: "We do not have a
///         constructor. This contract cannot be initialized with any valid
///         `privileges` by itself!"). Production seeds the `privileges` mapping via
///         SSTORE-injected proxy bytecode (DeployHelper / AmbireFactory), a path a
///         plain forge `new` cannot reproduce.
///
///         This harness adds the MINIMUM needed to get a deployable account: a
///         constructor that seeds the initial owner privilege. The constructor body
///         runs AS the account (`address(this)` is the account), which is exactly the
///         context Ambire's `setAddrPrivilege` self-call guard requires — so seeding
///         here is faithful to the invariant, just reached at deploy time instead of
///         via injected bytecode.
///
///         CRITICAL: every recovery-relevant function under test —
///         `executeBySender`, `setAddrPrivilege`, the anti-bricking re-check, the
///         namespaced storage layout — is inherited BYTE-FOR-BYTE from the vendored,
///         audited `AmbireAccount`. The harness overrides nothing. It only provides a
///         deploy seam. The production seed path differs (proxy bytecode); the
///         executor surface the adapter drives is identical.
contract AmbireAccountHarness is AmbireAccount {
    /// @param initialOwner The address granted the initial signer privilege
    ///                     (`bytes32(uint256(1))`), mirroring how a freshly deployed
    ///                     Ambire wallet is seeded with its owner key.
    constructor(address initialOwner) payable {
        // Write directly through Ambire's namespaced storage layout
        // (AMBIRE_STORAGE_POSITION = keccak256("ambire.smart.contracts.storage")).
        // `getAmbireStorage()` is `internal` on the base contract, so the harness
        // inherits it; `AmbireStorage` comes from the inherited `IAmbireAccount`.
        getAmbireStorage().privileges[initialOwner] = bytes32(uint256(1));
        // Emit the same event the real `setAddrPrivilege` would, so off-chain
        // indexers / test expectations see a consistent privilege-granted log.
        emit LogPrivilegeChanged(initialOwner, bytes32(uint256(1)));
    }
}
