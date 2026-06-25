# Kohaku Recovery v0 — contracts + anvil deploy harness

This is the **v0** evolution of the recovery PoC: the recovery controller now speaks the
**real ERC-7579** modular-account interface (`installModule` / `executeFromExecutor`) and
the **same controller binary drives two targets**:

1. a native **`Minimal7579Account`** (real `installModule` + `executeFromExecutor`), and
2. the **real Ambire account** via **`AmbireExecutorAdapter`** — a thin shim that *is* an
   ERC-7579 executor surface and translates `executeFromExecutor` into Ambire's
   `executeBySender`.

> **Scope / honesty note.** v0 proves the **END-TO-END PATH** — extension GUI → recovery
> controller → **real ERC-7579 `executeFromExecutor`** → account signer rotation on a local
> anvil chain. The recovery **policy is trivial on purpose** (`AlwaysValidMethod`, a single
> leg, ~zero timelock). v0 does **NOT** implement the real OR-over-AND combinator with
> per-method thresholds/timelocks; that is the separate, audit-gated piece that slots into
> the controller's `verify` step **without** touching `IERC7579Account` or
> `IRecoveryMethod`.

This package is **additive** to the prior PoC: the old `RecoveryControllerPoC`,
`IAccountAdapter`, `AmbireAccountAdapter`, and `RecoveryAdapterPoC.t.sol` remain in place
and green. The new v0 ERC-7579 surface lives alongside them.

---

## The one idea that makes "one controller, two targets" work

The controller's only account-facing dependency is the standard `IERC7579Account`:

```
RecoveryController --(IERC7579Account.executeFromExecutor)--> [ TARGET ]
```

Two things implement `IERC7579Account`:

- `Minimal7579Account` — implements it natively over its own `owner` storage.
- `AmbireExecutorAdapter` — implements it as a translation shim onto `executeBySender`.

The controller never branches on host. It is configured with **one** `target` (immutable
for v0). For the native demo `target == Minimal7579Account`; for the Ambire demo
`target == AmbireExecutorAdapter` (which wraps the real Ambire account). v0 deploys **one
controller per target** for clarity; a production controller could resolve a target per
call.

---

## Files

### New v0 contracts (`src/`)
- `src/lib/ERC7579Mode.sol` — minimal ERC-7579 mode/exec encoding: `MODE_SINGLE_DEFAULT`
  (= `bytes32(0)`), `encodeSingle` / `decodeSingle` for the packed single-call layout
  (`abi.encodePacked(address to, uint256 value, bytes callData)`). Producer (controller)
  and consumers (account, adapter) all route through this one library so they agree
  byte-for-byte.
- `src/interfaces/IERC7579Account.sol` — the minimal ERC-7579 surface the controller
  calls: `installModule`, `isModuleInstalled`, `executeFromExecutor`.
- `src/RecoveryController.sol` — v0 controller. Verifies the method proof, burns a
  per-target nonce, then rotates via `target.executeFromExecutor(MODE_SINGLE_DEFAULT,
  encodeSingle(target, 0, rotateOwner(newOwner)))`.
- `src/accounts/Minimal7579Account.sol` — native target: real `installModule` (executor,
  type 2, owner-gated), `executeFromExecutor` (executor-gated, single+default mode), and a
  self-call-only `rotateOwner(address)`.
- `src/adapters/AmbireExecutorAdapter.sol` — Ambire target: implements `IERC7579Account`,
  re-interprets the canonical `rotateOwner(address)` intent into
  `setAddrPrivilege(newOwner, 1)` routed through `executeBySender`. Holds **no policy**.

### Reused unchanged
- `src/interfaces/IRecoveryMethod.sol`, `src/methods/AlwaysValidMethod.sol`.
- `test/harness/AmbireAccountHarness.sol`, `test/ambire/**` (vendored, audited Ambire).

### Tests (`test/`)
- `test/RecoveryNative7579.t.sol` — native path: install controller as executor, rotate
  `owner` A→B from an unprivileged relayer; executor gate, self-call gate, owner-gated
  install, replay protection, method-deny, canonical hash encoding.
- `test/RecoveryAmbire7579.t.sol` — Ambire path: the SAME controller drives the real
  Ambire account through the adapter; proves rotation via `executeBySender`,
  `LogPrivilegeChanged(B,1)`, anti-bricking preserved, B can act / stranger cannot,
  controller-only gate, unauthorized-adapter revert, non-rotation-intent revert.

### Deploy harness (`script/`)
- `script/DeployV0.s.sol` — deploys + wires BOTH targets on anvil; writes
  `deployments/anvil-v0.json`. Env-driven, **no hardcoded addresses in contract src**.
- `script/deploy-v0.sh` — starts anvil if needed, runs the deploy, prints the manifest,
  optionally copies it into the extension (`EXTENSION_DIR=<path>`).

### SDK glue (`sdk/`)
- `sdk/recoveryV0Client.ts` — TypeScript twin of the v0 on-chain surface: the v0
  controller ABI (`initiateRecovery(address,bytes)`), the ERC-7579 single-call encoder
  (`encodeSingleExecution`, mirrors `ERC7579Mode.encodeSingle`), `encodeRotateOwnerCall`,
  `encodeInitiateRecoveryV0`, `buildExecuteFromExecutorArgs`. The PoC client
  (`recoveryAdapterClient.ts`, 3-arg `initiateRecovery`) is left intact for the old PoC;
  use the **v0** module against the v0 controller.

---

## Build & test

```bash
cd packages/recovery-poc
forge install foundry-rs/forge-std   # if lib/forge-std is missing
forge test                           # 18 tests: 7 native + 5 ambire + 6 prior PoC
```

## Deploy on local anvil

```bash
make deploy-v0
# or:
bash script/deploy-v0.sh
# copy the manifest into the extension as well:
EXTENSION_DIR=/path/to/kohaku-extension make deploy-v0
```

This writes `deployments/anvil-v0.json` (the extension consumes it verbatim):

```json
{
  "chainId": 31337,
  "rpcUrl": "http://127.0.0.1:8545",
  "demoOwner": "0x...",
  "newOwnerHint": "0x...",
  "relayerPrivateKey": "0xac0974bec...ff80",
  "native":  { "account": "0x...", "controller": "0x...", "method": "0x..." },
  "ambire":  { "account": "0x...", "adapter": "0x...", "controller": "0x...", "method": "0x..." }
}
```

> **Local-only secret.** `relayerPrivateKey` is anvil's well-known key #0 — safe for a LOCAL
> demo only. Never use this key or manifest on a real network.

### Anvil accounts used
- key #0 `0xf39F…2266` — deployer **and** `DEMO_OWNER` (the Ambire onboarding step is an
  owner self-call, so the script requires `deployer == DEMO_OWNER`) **and** the demo relayer.
- account #1 `0x7099…79C8` — `NEW_OWNER` hint (UI pre-fill).
- account #2 `0x3C44…93BC` — alternate rotation target.

---

## The exact call the extension makes to rotate

```
controller.initiateRecovery(address newOwner, bytes proof)
```

selector `initiateRecovery(address,bytes)`. For v0 (`AlwaysValidMethod`), `proof = 0x`.
Pick the `controller` address from the manifest by target: `native.controller` or
`ambire.controller`. No owner signature is required — the controller is an authorized
ERC-7579 executor (native) / Ambire-privileged executor (via the adapter).

Internally the controller emits one ERC-7579 execution:
`target.executeFromExecutor(MODE_SINGLE_DEFAULT, encodePacked(target, 0, rotateOwner(newOwner)))`.

### Verify the rotation on the CLI
```bash
# native: owner() should now equal newOwner
cast call <native.account> "owner()(address)" --rpc-url http://127.0.0.1:8545
# ambire: privileges(newOwner) should be 0x..01
cast call <ambire.account> "privileges(address)(bytes32)" <newOwner> --rpc-url http://127.0.0.1:8545
```

---

## Reconciliation notes (for the GUI/SDK phases)

- **Controller signature changed** from the PoC's `initiateRecovery(address account,
  address newOwner, bytes proof)` to v0's `initiateRecovery(address newOwner, bytes proof)`
  — the target is bound at construction. Consumers MUST use the v0 ABI.
- **`recoveryHash` encoding preserved**:
  `keccak256(abi.encode(controller, chainId, account, newOwner, nonce))` where `account ==
  address(target)`. The SDK's `computeRecoveryHash('controllerBound')` still matches (pass
  the controller's `target` as `account`).
- **The adapter re-interprets `rotateOwner(address)`** into Ambire
  `setAddrPrivilege(newOwner, 1)`. This is the one place the thin translation does semantic
  mapping; it holds no policy. The native account honors `rotateOwner` literally.
- **Two controllers deployed** (one per immutable target) — intentional for v0 clarity. The
  extension selects native/ambire by reading the right manifest address.
