// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Test} from "forge-std/Test.sol";

// --- System under test (the recovery kit, host-agnostic) ---
import {RecoveryController} from "../src/RecoveryController.sol";
import {AmbireExecutorAdapter} from "../src/adapters/AmbireExecutorAdapter.sol";
import {IERC7579Account} from "../src/interfaces/IERC7579Account.sol";
import {IRecoveryMethod} from "../src/interfaces/IRecoveryMethod.sol";
import {AlwaysValidMethod} from "../src/methods/AlwaysValidMethod.sol";

// --- The REAL Ambire account, made deployable for forge (logic untouched) ---
import {AmbireAccountHarness} from "./harness/AmbireAccountHarness.sol";
import {AmbireAccount} from "ambire/AmbireAccount.sol";
import {Transaction} from "ambire/libs/Transaction.sol";

/// @title  RecoveryController over the REAL Ambire account via a 7579 adapter
/// @notice Proves the v0 Ambire path: the EXACT SAME {RecoveryController} binary, whose
///         only account-facing dependency is {IERC7579Account}, drives the REAL Ambire
///         account to rotate its signer — through {AmbireExecutorAdapter}, which IS-A
///         7579 executor surface and translates `executeFromExecutor` into Ambire's
///         `executeBySender`. No recovery logic lives in the adapter; no Ambire
///         validator is involved; no owner signature is needed.
/// @dev    SCOPE: this tests the 7579 executor seam against the real Ambire account. It
///         does NOT test the OR-over-AND combinator (separate, audit-gated). The trivial
///         single-method policy stands in for the combinator at the controller's verify
///         step.
contract RecoveryAmbire7579Test is Test {
    uint256 internal constant PK_A = 0xA11CE;
    uint256 internal constant PK_B = 0xB0B;
    address internal ownerA;
    address internal ownerB;
    address internal relayer = makeAddr("relayer");

    bytes32 internal constant PRIV_AUTHORIZED = bytes32(uint256(1));

    AmbireAccountHarness internal account;
    AmbireExecutorAdapter internal adapter;
    RecoveryController internal controller;
    AlwaysValidMethod internal method;

    event RecoveryExecuted(
        address indexed target,
        address indexed newOwner,
        bytes32 recoveryHash,
        uint256 usedNonce
    );
    event LogPrivilegeChanged(address indexed addr, bytes32 priv);

    function setUp() public {
        ownerA = vm.addr(PK_A);
        ownerB = vm.addr(PK_B);
        vm.label(ownerA, "ownerA");
        vm.label(ownerB, "ownerB");

        // 1) Deploy the REAL Ambire account, seeded with owner A's privilege.
        account = new AmbireAccountHarness(ownerA);
        assertEq(account.privileges(ownerA), PRIV_AUTHORIZED, "setup: ownerA must start privileged");

        // 2) Deploy the trivial v0 method.
        method = new AlwaysValidMethod();

        // 3) Deploy adapter + controller using the forward (no-prediction) wiring:
        //    deploy the adapter first (its address depends only on `account`), deploy the
        //    controller against the now-known adapter address, then bind the controller
        //    into the adapter once via setController. This mirrors the on-chain Activate
        //    flow and removes the adapter<->controller CREATE2 circular dependency.
        adapter = new AmbireExecutorAdapter(address(account));
        controller = new RecoveryController(
            IERC7579Account(address(adapter)),
            IRecoveryMethod(address(method))
        );
        adapter.setController(address(controller));
        assertEq(adapter.controller(), address(controller), "setup: adapter bound to controller");
        assertEq(address(controller.target()), address(adapter), "setup: controller target is the adapter");

        // 4) Authorize the adapter as an executor on the account (the ONLY owner-signed
        //    step; onboarding, NOT recovery). setAddrPrivilege is self-call-only, so the
        //    owner reaches it via executeBySender on its own behalf.
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

    /// @notice Core thesis test. A relayer (unprivileged) drives the controller, which
    ///         calls the adapter's executeFromExecutor, which drives the REAL account via
    ///         executeBySender to install newOwner B — with no signature from A anywhere.
    function test_RecoveryRotatesSignerWithoutOwnerSignature() public {
        assertEq(account.privileges(ownerB), bytes32(0), "pre: ownerB must start unprivileged");
        uint256 nonceBefore = controller.recoveryNonce(address(adapter));
        assertEq(nonceBefore, 0, "pre: recovery nonce starts at 0");
        bytes32 expectedHash = controller.pendingRecoveryHash(ownerB);

        // CLAIM (drove it via executeBySender): assert the account receives that call.
        vm.expectCall(address(account), abi.encodeWithSelector(account.executeBySender.selector));
        // CLAIM (grant flowed through the account's OWN setAddrPrivilege): expect the
        // account to emit LogPrivilegeChanged(B, 1).
        vm.expectEmit(true, false, false, true, address(account));
        emit LogPrivilegeChanged(ownerB, PRIV_AUTHORIZED);
        // CLAIM (controller emits the recovery event with the right hash + nonce). The
        // controller's `target` is the adapter, so the event's `target` is the adapter.
        vm.expectEmit(true, true, false, true, address(controller));
        emit RecoveryExecuted(address(adapter), ownerB, expectedHash, nonceBefore);

        vm.prank(relayer);
        controller.initiateRecovery(ownerB, bytes(""));

        // CLAIM (new owner installed): B is now an authorized signer on the REAL account.
        assertEq(account.privileges(ownerB), PRIV_AUTHORIZED, "post: ownerB must now be privileged");
        // CLAIM (anti-bricking; additive): A is still privileged.
        assertTrue(account.privileges(ownerA) != bytes32(0), "post: ownerA privilege preserved");
        // CLAIM (executor survived its own batch): adapter privilege intact.
        assertEq(
            account.privileges(address(adapter)),
            PRIV_AUTHORIZED,
            "post: adapter privilege preserved (anti-bricking held)"
        );
        // CLAIM (nonce incremented).
        assertEq(controller.recoveryNonce(address(adapter)), nonceBefore + 1, "post: nonce++");

        // CLAIM (functional proof): B can now act on the account...
        Transaction[] memory noop = new Transaction[](0);
        vm.prank(ownerB);
        account.executeBySender(noop);
        // ...and a stranger still cannot.
        address stranger = address(0x5742);
        vm.prank(stranger);
        vm.expectRevert("INSUFFICIENT_PRIVILEGE");
        account.executeBySender(noop);
    }

    /// @notice Proves the adapter's caller-gate: only the configured controller may call
    ///         executeFromExecutor, so a rogue caller cannot reuse the adapter's
    ///         privilege on the account.
    function test_RevertWhen_CallerIsNotController() public {
        bytes memory rotateCall = abi.encodeWithSelector(controller.ROTATE_OWNER_SELECTOR(), ownerB);
        bytes memory execData = abi.encodePacked(address(adapter), uint256(0), rotateCall);

        vm.prank(relayer);
        vm.expectRevert(AmbireExecutorAdapter.NotController.selector);
        adapter.executeFromExecutor(bytes32(0), execData);
    }

    /// @notice Proves the account is the source of authorization truth: an adapter (and
    ///         thus controller) never granted privilege on a target account cannot
    ///         rotate. Reverts with Ambire's own INSUFFICIENT_PRIVILEGE.
    function test_RevertWhen_AdapterNotAuthorizedOnAccount() public {
        AmbireAccountHarness freshAccount = new AmbireAccountHarness(ownerA);
        AmbireExecutorAdapter freshAdapter = new AmbireExecutorAdapter(address(freshAccount));
        RecoveryController freshController = new RecoveryController(
            IERC7579Account(address(freshAdapter)),
            IRecoveryMethod(address(method))
        );
        freshAdapter.setController(address(freshController));
        assertEq(freshAccount.privileges(address(freshAdapter)), bytes32(0), "adapter unauthorized here");

        vm.prank(relayer);
        vm.expectRevert("INSUFFICIENT_PRIVILEGE");
        freshController.initiateRecovery(ownerB, bytes(""));

        assertEq(freshAccount.privileges(ownerB), bytes32(0), "no privilege granted on unauthorized account");
    }

    /// @notice Proves the adapter rejects a non-rotation intent (it holds no generic
    ///         execution surface — only the canonical rotateOwner intent translates).
    function test_RevertWhen_IntentIsNotRotateOwner() public {
        // A call with a bogus selector but otherwise well-formed single execution.
        bytes memory bogus = abi.encodeWithSelector(bytes4(0xdeadbeef), ownerB);
        bytes memory execData = abi.encodePacked(address(adapter), uint256(0), bogus);

        vm.prank(address(controller));
        vm.expectRevert(AmbireExecutorAdapter.UnsupportedIntent.selector);
        adapter.executeFromExecutor(bytes32(0), execData);
    }

    /// @notice Proves {setController} is single-shot: once bound it cannot be rebound, so
    ///         the controller binding is immutable in practice after Activate. Also proves
    ///         a fresh adapter rejects a zero controller.
    function test_RevertWhen_SetControllerCalledTwice() public {
        // The setUp() adapter is already bound to `controller`; rebinding must revert.
        vm.expectRevert(AmbireExecutorAdapter.ControllerAlreadySet.selector);
        adapter.setController(address(0xCAFE));
        assertEq(adapter.controller(), address(controller), "controller binding unchanged");

        // A fresh, unbound adapter rejects a zero controller and accepts a real one once.
        AmbireExecutorAdapter freshAdapter = new AmbireExecutorAdapter(address(account));
        assertEq(freshAdapter.controller(), address(0), "fresh adapter starts unbound");
        vm.expectRevert(AmbireExecutorAdapter.ZeroAddress.selector);
        freshAdapter.setController(address(0));
        freshAdapter.setController(address(controller));
        assertEq(freshAdapter.controller(), address(controller), "fresh adapter bound once");
    }

    /// @notice Locks the on-chain recoveryHash encoding to the canonical SDK tuple. Here
    ///         the `account` folded into the hash is the controller's target (the
    ///         adapter), matching `address(target)` in the controller.
    function test_RecoveryHashMatchesCanonicalSdkEncoding() public view {
        uint256 nonce = controller.recoveryNonce(address(adapter));
        bytes32 onchain = controller.pendingRecoveryHash(ownerB);
        bytes32 canonical = keccak256(
            abi.encode(address(controller), block.chainid, address(adapter), ownerB, nonce)
        );
        assertEq(onchain, canonical, "controller recoveryHash must equal canonical SDK encoding");
    }
}
