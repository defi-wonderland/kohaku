// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Test} from "forge-std/Test.sol";

// --- System under test (the recovery kit, host-agnostic) ---
import {RecoveryControllerPoC} from "../src/RecoveryControllerPoC.sol";
import {AmbireAccountAdapter} from "../src/adapters/AmbireAccountAdapter.sol";
import {IAccountAdapter} from "../src/interfaces/IAccountAdapter.sol";
import {IRecoveryMethod} from "../src/interfaces/IRecoveryMethod.sol";
import {AlwaysValidMethod} from "../src/methods/AlwaysValidMethod.sol";

// --- The REAL Ambire account, made deployable for forge (logic untouched) ---
import {AmbireAccountHarness} from "./harness/AmbireAccountHarness.sol";
import {AmbireAccount} from "ambire/AmbireAccount.sol";
import {Transaction} from "ambire/libs/Transaction.sol";

/// @notice Recovery method that authorizes EXACTLY ONE committed `recoveryHash`.
/// @dev    Test-only. Unlike {AlwaysValidMethod} (which ignores its inputs and can
///         therefore never demonstrate replay protection), this method binds its
///         decision to the `recoveryHash` it was constructed with. Because the
///         controller folds the per-account `recoveryNonce` into `recoveryHash`, a
///         second submission of the SAME proof recomputes a DIFFERENT hash (nonce has
///         advanced), this method then returns false, and the controller reverts.
///         This is what makes the "replay reverts" assertion meaningful.
contract HashBoundMethod is IRecoveryMethod {
    bytes32 public immutable authorizedHash;

    constructor(bytes32 _authorizedHash) {
        authorizedHash = _authorizedHash;
    }

    function verify(
        address, /* account */
        bytes32 recoveryHash,
        bytes calldata /* proof */
    ) external view override returns (bool ok) {
        return recoveryHash == authorizedHash;
    }
}

/// @notice Recovery method that always rejects. Used to prove the controller honors a
///         method's "deny" decision (policy is consulted, not bypassed).
contract RejectingMethod is IRecoveryMethod {
    function verify(address, bytes32, bytes calldata) external pure override returns (bool) {
        return false;
    }
}

/// @title  RecoveryAdapterPoC end-to-end test
/// @notice Proves the central Kohaku thesis: an EXTERNAL, ERC-7579-executor-style
///         controller can drive the REAL Ambire smart account to rotate its signer,
///         WITHOUT any recovery logic living inside an Ambire validator. The bridge is
///         the thin, swappable {AmbireAccountAdapter}; the controller never references
///         an Ambire type.
/// @dev    SCOPE: this tests the ADAPTER / EXECUTION seam against the real Ambire
///         account. It does NOT test the real OR-over-AND combinator (that is the
///         separate, audit-gated piece). The trivial single-method policy here stands
///         in for the combinator at the controller's verify step.
contract RecoveryAdapterPoCTest is Test {
    // Initial owner (key A) and the recovery target signer (key B).
    uint256 internal constant PK_A = 0xA11CE;
    uint256 internal constant PK_B = 0xB0B;
    address internal ownerA;
    address internal ownerB;

    // A relayer EOA with NO privilege on the account — it submits recovery to prove
    // that authorization comes from the method proof, not from the caller.
    address internal relayer = makeAddr("relayer");

    // The privilege value a normal authorized Ambire key holds.
    bytes32 internal constant PRIV_AUTHORIZED = bytes32(uint256(1));

    // System under test, wired in setUp.
    AmbireAccountHarness internal account;
    AmbireAccountAdapter internal adapter;
    RecoveryControllerPoC internal controller;
    AlwaysValidMethod internal method;

    // Mirror of the controller's event, for vm.expectEmit.
    event RecoveryExecuted(
        address indexed account,
        address indexed newOwner,
        bytes32 recoveryHash,
        uint256 usedNonce
    );

    // Mirror of Ambire's privilege-changed event, to prove the grant flowed through
    // the account's OWN setAddrPrivilege (i.e. via executeBySender), not a direct poke.
    event LogPrivilegeChanged(address indexed addr, bytes32 priv);

    function setUp() public {
        ownerA = vm.addr(PK_A);
        ownerB = vm.addr(PK_B);
        vm.label(ownerA, "ownerA");
        vm.label(ownerB, "ownerB");

        // 1) Deploy the REAL Ambire account, seeded with owner A's privilege.
        account = new AmbireAccountHarness(ownerA);
        assertEq(account.privileges(ownerA), PRIV_AUTHORIZED, "setup: ownerA must start privileged");

        // 2) Deploy the recovery method (trivial PoC policy stand-in).
        method = new AlwaysValidMethod();

        // 3) Deploy adapter + controller.
        //    The adapter's `controller` is immutable, so the controller address must be
        //    known before the adapter is constructed. We predict the controller's
        //    CREATE address (this test deploys it on the very next nonce) and pin the
        //    adapter to it. This avoids any setter and keeps both wirings immutable.
        address predictedController = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        adapter = new AmbireAccountAdapter(predictedController);
        controller = new RecoveryControllerPoC(IAccountAdapter(address(adapter)), IRecoveryMethod(address(method)));
        assertEq(address(controller), predictedController, "setup: controller address prediction must hold");
        assertEq(adapter.controller(), address(controller), "setup: adapter must be bound to controller");

        // 4) Authorize the adapter as an executor on the account.
        //    This is the ONLY owner-signed step in the whole flow (onboarding, NOT
        //    recovery). setAddrPrivilege is self-call-only, so the owner reaches it by
        //    having the account execute it on its own behalf. ownerA is privileged, so
        //    ownerA may call executeBySender; the account then self-calls
        //    setAddrPrivilege(adapter, 1).
        Transaction[] memory authCalls = new Transaction[](1);
        authCalls[0] = Transaction({
            to: address(account),
            value: 0,
            data: abi.encodeWithSelector(
                AmbireAccount.setAddrPrivilege.selector,
                address(adapter),
                PRIV_AUTHORIZED
            )
        });
        vm.prank(ownerA);
        account.executeBySender(authCalls);
        assertEq(
            account.privileges(address(adapter)),
            PRIV_AUTHORIZED,
            "setup: adapter must be a privileged executor after onboarding"
        );
    }

    // ---------------------------------------------------------------------------
    // THE PROOF: external controller rotates the signer with NO owner signature.
    // ---------------------------------------------------------------------------

    /// @notice Core thesis test. A relayer (unprivileged) drives the controller, which
    ///         drives the adapter, which drives the REAL account via executeBySender to
    ///         install newOwner B — with no signature from owner A anywhere.
    function test_RecoveryRotatesSignerWithoutOwnerSignature() public {
        // --- Pre-state: B is NOT yet an authorized signer. ---
        assertEq(account.privileges(ownerB), bytes32(0), "pre: ownerB must start unprivileged");
        // The nonce that this recovery will consume, and the exact action commitment.
        uint256 nonceBefore = controller.recoveryNonce(address(account));
        assertEq(nonceBefore, 0, "pre: recovery nonce starts at 0");
        bytes32 expectedHash = controller.pendingRecoveryHash(address(account), ownerB);

        // CLAIM (drove it via executeBySender): the adapter must use exactly Ambire's
        // executor primitive. Assert the account receives an executeBySender call.
        vm.expectCall(
            address(account),
            abi.encodeWithSelector(account.executeBySender.selector)
        );
        // CLAIM (grant flowed through the account's OWN setAddrPrivilege): expect the
        // account to emit LogPrivilegeChanged(B, 1) — proving the rotation went through
        // executeBySender -> executeBatch -> self-call setAddrPrivilege, not a direct
        // external write (which the self-call guard would have rejected anyway).
        vm.expectEmit(true, false, false, true, address(account));
        emit LogPrivilegeChanged(ownerB, PRIV_AUTHORIZED);
        // CLAIM (controller emits the recovery event with the right hash + consumed nonce).
        vm.expectEmit(true, true, false, true, address(controller));
        emit RecoveryExecuted(address(account), ownerB, expectedHash, nonceBefore);

        // --- Drive recovery from an UNPRIVILEGED relayer (no owner key involved). ---
        vm.prank(relayer);
        controller.initiateRecovery(address(account), ownerB, bytes(""));

        // --- Post-state assertions (each tied to a thesis claim) ---

        // CLAIM (new owner installed): B is now an authorized signer on the REAL account.
        assertEq(account.privileges(ownerB), PRIV_AUTHORIZED, "post: ownerB must now be privileged");

        // CLAIM (anti-bricking respected; rotation is additive): A is still privileged.
        assertTrue(account.privileges(ownerA) != bytes32(0), "post: ownerA privilege preserved");

        // CLAIM (executor survived its own batch): the adapter's privilege is intact, so
        // Ambire's post-batch anti-bricking check (PRIVILEGE_NOT_DOWNGRADED) did not revert.
        assertEq(
            account.privileges(address(adapter)),
            PRIV_AUTHORIZED,
            "post: adapter privilege preserved (anti-bricking held)"
        );

        // CLAIM (recovery nonce incremented): replay protection state advanced by one.
        assertEq(
            controller.recoveryNonce(address(account)),
            nonceBefore + 1,
            "post: recovery nonce must increment"
        );

        // CLAIM (functional proof): B can now actually act as a signer on the account...
        Transaction[] memory noop = new Transaction[](0);
        vm.prank(ownerB);
        account.executeBySender(noop); // succeeds because B is privileged

        // ...and a stranger still cannot, confirming the privilege check is real (the
        // rotation granted authority precisely to B, not to everyone).
        address stranger = address(0x5742); // never granted any privilege
        vm.prank(stranger);
        vm.expectRevert("INSUFFICIENT_PRIVILEGE");
        account.executeBySender(noop);
    }

    // ---------------------------------------------------------------------------
    // REPLAY PROTECTION: re-submitting the same proof reverts (nonce-bound).
    // ---------------------------------------------------------------------------

    /// @notice Proves the per-account recovery nonce makes a proof single-use. Uses a
    ///         {HashBoundMethod} pinned to the nonce-0 commitment: the first recovery
    ///         succeeds and burns the nonce; replaying the SAME proof recomputes the
    ///         hash at nonce 1, which the method no longer authorizes -> revert.
    /// @dev    {AlwaysValidMethod} cannot demonstrate this (it ignores the hash), so we
    ///         deploy a controller wired to a hash-bound method for this test only. The
    ///         adapter/account wiring is the production path; only the method changes.
    function test_RevertWhen_SameProofReplayed() public {
        // Build a controller whose method authorizes only the nonce-0 commitment.
        // We must know that commitment before the method exists, so compute it from a
        // throwaway controller's helper... simpler: derive it the same way the
        // controller does, using the predicted controller address.
        address predictedController = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 2);
        bytes32 boundHash = keccak256(
            abi.encode(predictedController, block.chainid, address(account), ownerB, uint256(0))
        );
        HashBoundMethod boundMethod = new HashBoundMethod(boundHash);
        AmbireAccountAdapter boundAdapter = new AmbireAccountAdapter(predictedController);
        RecoveryControllerPoC boundController =
            new RecoveryControllerPoC(IAccountAdapter(address(boundAdapter)), IRecoveryMethod(address(boundMethod)));
        assertEq(address(boundController), predictedController, "prediction must hold for bound controller");

        // Authorize the new adapter on the account (onboarding step for this fixture).
        Transaction[] memory authCalls = new Transaction[](1);
        authCalls[0] = Transaction({
            to: address(account),
            value: 0,
            data: abi.encodeWithSelector(
                AmbireAccount.setAddrPrivilege.selector,
                address(boundAdapter),
                PRIV_AUTHORIZED
            )
        });
        vm.prank(ownerA);
        account.executeBySender(authCalls);

        // First submission: authorized (hash matches nonce-0 commitment) -> succeeds.
        vm.prank(relayer);
        boundController.initiateRecovery(address(account), ownerB, bytes(""));
        assertEq(account.privileges(ownerB), PRIV_AUTHORIZED, "replay: first recovery installs B");
        assertEq(boundController.recoveryNonce(address(account)), 1, "replay: nonce burned to 1");

        // Replay the IDENTICAL call (same proof). The controller now computes the hash
        // at nonce 1, which the method does not authorize -> MethodRejected.
        vm.prank(relayer);
        vm.expectRevert(RecoveryControllerPoC.MethodRejected.selector);
        boundController.initiateRecovery(address(account), ownerB, bytes(""));

        // Nonce did not advance further (the revert rolled back the effect).
        assertEq(boundController.recoveryNonce(address(account)), 1, "replay: nonce unchanged after revert");
    }

    // ---------------------------------------------------------------------------
    // NEGATIVE: an UNAUTHORIZED controller cannot rotate.
    // ---------------------------------------------------------------------------

    /// @notice Proves the account is the source of authorization truth: an adapter (and
    ///         thus controller) that was NEVER granted privilege on a target account
    ///         cannot rotate its signer. The rotation reverts with Ambire's own
    ///         INSUFFICIENT_PRIVILEGE, and no privilege is granted.
    function test_RevertWhen_AdapterNotAuthorizedOnAccount() public {
        // A brand-new account that has only ownerA and never authorized our adapter.
        AmbireAccountHarness freshAccount = new AmbireAccountHarness(ownerA);
        assertEq(freshAccount.privileges(address(adapter)), bytes32(0), "adapter must be unauthorized here");

        // Recovery against the un-opted-in account must revert from the account itself.
        vm.prank(relayer);
        vm.expectRevert("INSUFFICIENT_PRIVILEGE");
        controller.initiateRecovery(address(freshAccount), ownerB, bytes(""));

        // No signer was installed.
        assertEq(freshAccount.privileges(ownerB), bytes32(0), "no privilege granted on unauthorized account");
    }

    /// @notice Proves the adapter's caller-gate: only the configured controller may
    ///         drive it. A direct call by anyone else reverts with NotController, so a
    ///         rogue contract cannot reuse the adapter's privilege on the account.
    function test_RevertWhen_CallerIsNotController() public {
        vm.prank(relayer);
        vm.expectRevert(AmbireAccountAdapter.NotController.selector);
        adapter.rotateSigner(address(account), ownerB);

        // And the same gate guards the generic execute() path.
        IAccountAdapter.Call[] memory calls = new IAccountAdapter.Call[](0);
        vm.prank(relayer);
        vm.expectRevert(AmbireAccountAdapter.NotController.selector);
        adapter.execute(address(account), calls);
    }

    /// @notice Proves policy is consulted, not bypassed: when the method denies, the
    ///         controller reverts MethodRejected and rotates nothing.
    function test_RevertWhen_MethodRejects() public {
        RejectingMethod rejecting = new RejectingMethod();
        // Wire a fresh controller to the rejecting method (adapter/account unchanged).
        // Deploy order from here: rejAdapter (nonce N), then rejController (nonce N+1),
        // so the controller lands at the current nonce + 1.
        address predictedController = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        AmbireAccountAdapter rejAdapter = new AmbireAccountAdapter(predictedController);
        RecoveryControllerPoC rejController =
            new RecoveryControllerPoC(IAccountAdapter(address(rejAdapter)), IRecoveryMethod(address(rejecting)));
        assertEq(address(rejController), predictedController, "rejecting fixture: controller prediction must hold");

        // Authorize the rejecting controller's adapter so the ONLY thing that can stop
        // recovery is the method decision (isolates the policy check).
        Transaction[] memory authCalls = new Transaction[](1);
        authCalls[0] = Transaction({
            to: address(account),
            value: 0,
            data: abi.encodeWithSelector(
                AmbireAccount.setAddrPrivilege.selector,
                address(rejAdapter),
                PRIV_AUTHORIZED
            )
        });
        vm.prank(ownerA);
        account.executeBySender(authCalls);

        vm.prank(relayer);
        vm.expectRevert(RecoveryControllerPoC.MethodRejected.selector);
        rejController.initiateRecovery(address(account), ownerB, bytes(""));

        assertEq(account.privileges(ownerB), bytes32(0), "method rejection must rotate nothing");
        assertEq(rejController.recoveryNonce(address(account)), 0, "rejected recovery must not burn nonce");
    }

    /// @notice Locks the on-chain recoveryHash encoding to the canonical tuple the
    ///         off-chain SDK (`computeRecoveryHash`, scheme `'controllerBound'`) mirrors:
    ///         keccak256(abi.encode(controller, chainId, account, newOwner, nonce)).
    /// @dev    Guard against contract<>SDK drift. If the controller's `_recoveryHash`
    ///         layout ever changes, this fails and the SDK must be updated in lockstep —
    ///         otherwise real method proofs (bound off-chain) would be rejected on-chain.
    function test_RecoveryHashMatchesCanonicalSdkEncoding() public view {
        uint256 nonce = controller.recoveryNonce(address(account));
        bytes32 onchain = controller.pendingRecoveryHash(address(account), ownerB);
        bytes32 canonical = keccak256(
            abi.encode(address(controller), block.chainid, address(account), ownerB, nonce)
        );
        assertEq(
            onchain,
            canonical,
            "controller recoveryHash must equal the canonical (controllerBound) SDK encoding"
        );
    }
}
