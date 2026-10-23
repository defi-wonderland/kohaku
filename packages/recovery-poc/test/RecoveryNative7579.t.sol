// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Test} from "forge-std/Test.sol";

// --- System under test (the recovery kit, host-agnostic) ---
import {RecoveryController} from "../src/RecoveryController.sol";
import {Minimal7579Account} from "../src/accounts/Minimal7579Account.sol";
import {IERC7579Account} from "../src/interfaces/IERC7579Account.sol";
import {IRecoveryMethod} from "../src/interfaces/IRecoveryMethod.sol";
import {AlwaysValidMethod} from "../src/methods/AlwaysValidMethod.sol";

/// @notice Recovery method that authorizes EXACTLY ONE committed `recoveryHash`. Used to
///         make the replay-protection assertion meaningful (see {AlwaysValidMethod},
///         which ignores its inputs and so can never demonstrate replay).
contract HashBoundMethod is IRecoveryMethod {
    bytes32 public immutable authorizedHash;

    constructor(bytes32 _authorizedHash) {
        authorizedHash = _authorizedHash;
    }

    function verify(address, bytes32 recoveryHash, bytes calldata) external view override returns (bool) {
        return recoveryHash == authorizedHash;
    }
}

/// @notice Recovery method that always rejects, to prove the controller honors a deny.
contract RejectingMethod is IRecoveryMethod {
    function verify(address, bytes32, bytes calldata) external pure override returns (bool) {
        return false;
    }
}

/// @title  RecoveryController over a NATIVE ERC-7579 account
/// @notice Proves the v0 native path: the controller, installed as a real ERC-7579
///         EXECUTOR module, rotates a {Minimal7579Account}'s owner via the standard
///         {IERC7579Account.executeFromExecutor} primitive — with NO owner signature
///         and driven by an unprivileged relayer. This is the SAME controller binary
///         the Ambire test drives; only the `target` differs.
contract RecoveryNative7579Test is Test {
    uint256 internal constant MODULE_TYPE_EXECUTOR = 2;

    address internal ownerA = makeAddr("ownerA");
    address internal ownerB = makeAddr("ownerB");
    // A relayer with no rights anywhere — proves authorization comes from the proof.
    address internal relayer = makeAddr("relayer");

    Minimal7579Account internal account;
    RecoveryController internal controller;
    AlwaysValidMethod internal method;

    event RecoveryExecuted(
        address indexed target,
        address indexed newOwner,
        bytes32 recoveryHash,
        uint256 usedNonce
    );
    event OwnerRotated(address indexed previousOwner, address indexed newOwner);

    function setUp() public {
        // 1) Deploy the native account seeded with owner A.
        account = new Minimal7579Account(ownerA);
        assertEq(account.owner(), ownerA, "setup: ownerA must start as owner");

        // 2) Deploy the trivial v0 method.
        method = new AlwaysValidMethod();

        // 3) Deploy the controller bound to the native account as its 7579 target.
        controller = new RecoveryController(
            IERC7579Account(address(account)),
            IRecoveryMethod(address(method))
        );

        // 4) Owner installs the controller as an EXECUTOR module (the one owner-signed
        //    onboarding step; NOT recovery).
        vm.prank(ownerA);
        account.installModule(MODULE_TYPE_EXECUTOR, address(controller), "");
        assertTrue(
            account.isModuleInstalled(MODULE_TYPE_EXECUTOR, address(controller), ""),
            "setup: controller must be an installed executor"
        );
    }

    /// @notice Core native-path test: an unprivileged relayer drives the controller,
    ///         which calls the REAL executeFromExecutor to rotate owner A -> B.
    function test_RecoveryRotatesOwnerViaExecuteFromExecutor() public {
        uint256 nonceBefore = controller.recoveryNonce(address(account));
        assertEq(nonceBefore, 0, "pre: nonce starts at 0");
        bytes32 expectedHash = controller.pendingRecoveryHash(ownerB);

        // CLAIM (rotation happens through the account's own OwnerRotated event).
        vm.expectEmit(true, true, false, true, address(account));
        emit OwnerRotated(ownerA, ownerB);
        // CLAIM (controller emits the recovery event with the right hash + consumed nonce).
        vm.expectEmit(true, true, false, true, address(controller));
        emit RecoveryExecuted(address(account), ownerB, expectedHash, nonceBefore);

        vm.prank(relayer);
        controller.initiateRecovery(ownerB, bytes(""));

        // CLAIM (new owner installed): the account's signer is now B.
        assertEq(account.owner(), ownerB, "post: owner rotated to B");
        // CLAIM (nonce incremented): replay-protection state advanced.
        assertEq(controller.recoveryNonce(address(account)), nonceBefore + 1, "post: nonce++");
    }

    /// @notice Proves the executor gate: executeFromExecutor reverts for a caller that
    ///         is not an installed executor module (so only the controller can rotate).
    function test_RevertWhen_CallerNotInstalledExecutor() public {
        // Build the same single-call rotation execution the controller would emit.
        bytes memory rotateCall = abi.encodeWithSelector(account.rotateOwner.selector, ownerB);
        bytes memory execData = abi.encodePacked(address(account), uint256(0), rotateCall);

        vm.prank(relayer);
        vm.expectRevert(Minimal7579Account.NotInstalledExecutor.selector);
        account.executeFromExecutor(bytes32(0), execData);

        assertEq(account.owner(), ownerA, "owner unchanged after rejected executor call");
    }

    /// @notice Proves rotateOwner is self-call-only (not externally callable), so the
    ///         only rotation path is through an installed executor.
    function test_RevertWhen_RotateOwnerCalledDirectly() public {
        vm.prank(ownerA);
        vm.expectRevert(Minimal7579Account.OnlySelf.selector);
        account.rotateOwner(ownerB);
    }

    /// @notice Proves installModule is owner-gated.
    function test_RevertWhen_NonOwnerInstallsModule() public {
        vm.prank(relayer);
        vm.expectRevert(Minimal7579Account.NotOwner.selector);
        account.installModule(MODULE_TYPE_EXECUTOR, relayer, "");
    }

    /// @notice Proves replay protection: re-submitting the same proof reverts because
    ///         the per-target nonce advanced and the hash-bound method no longer
    ///         authorizes the recomputed commitment.
    function test_RevertWhen_SameProofReplayed() public {
        // Predict the controller address so we can pin a hash-bound method to its
        // nonce-0 commitment. Deploy order: method (nonce N), controller (nonce N+1).
        address predictedController = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        bytes32 boundHash = keccak256(
            abi.encode(predictedController, block.chainid, address(account), ownerB, uint256(0))
        );
        HashBoundMethod boundMethod = new HashBoundMethod(boundHash);
        RecoveryController boundController = new RecoveryController(
            IERC7579Account(address(account)),
            IRecoveryMethod(address(boundMethod))
        );
        assertEq(address(boundController), predictedController, "prediction must hold");

        // Install the bound controller as executor (fixture onboarding).
        vm.prank(ownerA);
        account.installModule(MODULE_TYPE_EXECUTOR, address(boundController), "");

        // First submission succeeds and burns the nonce.
        vm.prank(relayer);
        boundController.initiateRecovery(ownerB, bytes(""));
        assertEq(account.owner(), ownerB, "replay: first recovery installs B");
        assertEq(boundController.recoveryNonce(address(account)), 1, "replay: nonce burned to 1");

        // Replay the identical call: hash recomputed at nonce 1, method denies -> revert.
        vm.prank(relayer);
        vm.expectRevert(RecoveryController.MethodRejected.selector);
        boundController.initiateRecovery(ownerB, bytes(""));
        assertEq(boundController.recoveryNonce(address(account)), 1, "replay: nonce unchanged after revert");
    }

    /// @notice Proves policy is consulted: a rejecting method makes the controller
    ///         revert MethodRejected and rotate nothing.
    function test_RevertWhen_MethodRejects() public {
        RejectingMethod rejecting = new RejectingMethod();
        RecoveryController rejController = new RecoveryController(
            IERC7579Account(address(account)),
            IRecoveryMethod(address(rejecting))
        );
        vm.prank(ownerA);
        account.installModule(MODULE_TYPE_EXECUTOR, address(rejController), "");

        vm.prank(relayer);
        vm.expectRevert(RecoveryController.MethodRejected.selector);
        rejController.initiateRecovery(ownerB, bytes(""));

        assertEq(account.owner(), ownerA, "method rejection must rotate nothing");
        assertEq(rejController.recoveryNonce(address(account)), 0, "rejected recovery must not burn nonce");
    }

    /// @notice Locks the on-chain recoveryHash encoding to the canonical tuple the
    ///         off-chain SDK (`controllerBound` scheme) mirrors.
    function test_RecoveryHashMatchesCanonicalSdkEncoding() public view {
        uint256 nonce = controller.recoveryNonce(address(account));
        bytes32 onchain = controller.pendingRecoveryHash(ownerB);
        bytes32 canonical = keccak256(
            abi.encode(address(controller), block.chainid, address(account), ownerB, nonce)
        );
        assertEq(onchain, canonical, "controller recoveryHash must equal canonical SDK encoding");
    }
}
