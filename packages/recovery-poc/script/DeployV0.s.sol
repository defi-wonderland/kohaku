// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {RecoveryController} from "../src/RecoveryController.sol";
import {Minimal7579Account} from "../src/accounts/Minimal7579Account.sol";
import {AmbireExecutorAdapter} from "../src/adapters/AmbireExecutorAdapter.sol";
import {IERC7579Account} from "../src/interfaces/IERC7579Account.sol";
import {IRecoveryMethod} from "../src/interfaces/IRecoveryMethod.sol";
import {AlwaysValidMethod} from "../src/methods/AlwaysValidMethod.sol";

import {AmbireAccountHarness} from "../test/harness/AmbireAccountHarness.sol";
import {AmbireAccount} from "ambire/AmbireAccount.sol";
import {Transaction} from "ambire/libs/Transaction.sol";

/// @title  DeployV0
/// @author Kohaku
/// @notice Deploys and wires the WHOLE recovery v0 demo on a single chain (anvil), for
///         BOTH targets, then writes a machine-readable address manifest the extension
///         consumes.
/// @dev    DEPLOYS:
///           - AlwaysValidMethod (shared trivial v0 policy);
///           - NATIVE path:  Minimal7579Account(owner) + RecoveryController(native) +
///             installs the controller as a 7579 executor on the account;
///           - AMBIRE path:  AmbireAccountHarness(owner) + AmbireExecutorAdapter +
///             RecoveryController(ambire) + authorizes the adapter as an Ambire executor.
///
///         NO HARDCODED ADDRESSES. Reads:
///           - PRIVATE_KEY (uint)    — the deployer/broadcaster (anvil key #0); also the
///             demo relayer recorded in the manifest.
///           - DEMO_OWNER  (address) — the initial signer seeded into BOTH accounts.
///           - NEW_OWNER   (address, optional) — a hint the UI pre-fills as the rotation
///             target. Defaults to zero if unset.
///
///         The deployer must equal DEMO_OWNER for the Ambire onboarding step (it submits
///         the owner-signed `executeBySender([setAddrPrivilege(adapter,1)])`). The shell
///         wrapper passes anvil key #0 and account #0 so this holds.
///
///         WHY TWO CONTROLLERS. `target` is immutable, so v0 deploys one controller per
///         target for clarity. The extension selects native/ambire purely by reading the
///         right address out of the manifest.
contract DeployV0 is Script {
    /// @notice ERC-7579 executor module type id.
    uint256 internal constant MODULE_TYPE_EXECUTOR = 2;

    /// @notice Ambire's "authorized" privilege value.
    bytes32 internal constant PRIV_AUTHORIZED = bytes32(uint256(1));

    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);
        address owner = vm.envAddress("DEMO_OWNER");
        address newOwnerHint = vm.envOr("NEW_OWNER", address(0));

        require(deployer == owner, "DeployV0: deployer must equal DEMO_OWNER (Ambire onboarding self-call)");

        vm.startBroadcast(deployerPk);

        // ----- Shared trivial v0 policy -----
        AlwaysValidMethod method = new AlwaysValidMethod();

        // ----- NATIVE target -----
        Minimal7579Account nativeAccount = new Minimal7579Account(owner);
        RecoveryController nativeCtrl = new RecoveryController(
            IERC7579Account(address(nativeAccount)),
            IRecoveryMethod(address(method))
        );
        // Owner installs the controller as a 7579 executor (only owner-signed step).
        nativeAccount.installModule(MODULE_TYPE_EXECUTOR, address(nativeCtrl), "");

        // ----- AMBIRE target -----
        AmbireAccountHarness ambireAccount = new AmbireAccountHarness(owner);
        // The adapter's controller is immutable, so predict the controller's CREATE
        // address (deployed on the very next broadcaster nonce) and pin the adapter.
        address predictedCtrl = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);
        AmbireExecutorAdapter ambireAdapter = new AmbireExecutorAdapter(address(ambireAccount), predictedCtrl);
        RecoveryController ambireCtrl = new RecoveryController(
            IERC7579Account(address(ambireAdapter)),
            IRecoveryMethod(address(method))
        );
        require(address(ambireCtrl) == predictedCtrl, "DeployV0: ambire controller prediction failed");

        // Owner authorizes the adapter as an Ambire executor (only owner-signed step).
        // setAddrPrivilege is self-call-only, so the owner reaches it via executeBySender
        // on the account's own behalf. The broadcaster is the owner (== privileged).
        Transaction[] memory authCalls = new Transaction[](1);
        authCalls[0] = Transaction({
            to: address(ambireAccount),
            value: 0,
            data: abi.encodeWithSelector(
                AmbireAccount.setAddrPrivilege.selector,
                address(ambireAdapter),
                PRIV_AUTHORIZED
            )
        });
        ambireAccount.executeBySender(authCalls);

        vm.stopBroadcast();

        // ----- Console summary (human-readable) -----
        console2.log("=== Recovery v0 deployment ===");
        console2.log("chainId", block.chainid);
        console2.log("demoOwner", owner);
        console2.log("newOwnerHint", newOwnerHint);
        console2.log("method", address(method));
        console2.log("native.account", address(nativeAccount));
        console2.log("native.controller", address(nativeCtrl));
        console2.log("ambire.account", address(ambireAccount));
        console2.log("ambire.adapter", address(ambireAdapter));
        console2.log("ambire.controller", address(ambireCtrl));

        // ----- Machine-readable manifest the extension consumes verbatim -----
        _writeManifest(
            owner,
            newOwnerHint,
            address(method),
            address(nativeAccount),
            address(nativeCtrl),
            address(ambireAccount),
            address(ambireAdapter),
            address(ambireCtrl)
        );
    }

    /// @dev Writes `deployments/anvil-v0.json` matching the shape the extension reads.
    ///      The relayer private key is the deployer key (anvil #0) for the demo only.
    ///      Built with vm.serialize* so nested objects are emitted correctly.
    function _writeManifest(
        address owner,
        address newOwnerHint,
        address method,
        address nativeAccount,
        address nativeController,
        address ambireAccount,
        address ambireAdapter,
        address ambireController
    ) internal {
        string memory nativeObj = "nativeObj";
        vm.serializeAddress(nativeObj, "account", nativeAccount);
        vm.serializeAddress(nativeObj, "controller", nativeController);
        string memory nativeJson = vm.serializeAddress(nativeObj, "method", method);

        string memory ambireObj = "ambireObj";
        vm.serializeAddress(ambireObj, "account", ambireAccount);
        vm.serializeAddress(ambireObj, "adapter", ambireAdapter);
        vm.serializeAddress(ambireObj, "controller", ambireController);
        string memory ambireJson = vm.serializeAddress(ambireObj, "method", method);

        string memory root = "root";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeString(root, "rpcUrl", "http://127.0.0.1:8545");
        vm.serializeAddress(root, "demoOwner", owner);
        vm.serializeAddress(root, "newOwnerHint", newOwnerHint);
        // The deployer/relayer key is recorded for the demo's owner-free relayer send.
        // anvil key #0 is a well-known public test key — safe to embed for a LOCAL demo
        // only. NEVER use this key (or this manifest) on a real network.
        vm.serializeString(
            root,
            "relayerPrivateKey",
            "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
        );
        vm.serializeString(root, "native", nativeJson);
        string memory finalJson = vm.serializeString(root, "ambire", ambireJson);

        vm.writeJson(finalJson, "./deployments/anvil-v0.json");
        console2.log("Wrote manifest -> deployments/anvil-v0.json");
    }
}
