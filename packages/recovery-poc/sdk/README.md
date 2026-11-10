# recovery-poc — SDK glue (`sdk/`)

Thin, typed TypeScript that drives the recovery-adapter PoC end to end from a
client's point of view: it builds the calldata that flows through
`RecoveryControllerPoC` → `AmbireAccountAdapter` → the real `AmbireAccount`, and
computes the off-chain `recoveryHash` a method proof binds to.

This mirrors how the Kohaku browser extension consumes `@kohaku-eth/*` today:
small, typed calldata builders plus an optional client wrapper — not a monolith.

> **Scope.** This proves the *SDK surface* of the adapter/execution seam: that
> the entire client footprint of host recovery is "encode two calls." It does
> **not** implement the OR-over-AND combinator, real method proofs, timelocks,
> or guardian management — those are the separate, audit-gated kit. See the
> package root `README.md` for the full "what this proves / does NOT prove."

## The two SDK touch-points

Everything reduces to two calls:

| # | Function | Who signs | When |
|---|----------|-----------|------|
| (a) | `buildAuthorizeAdapterCall(account, adapter)` | the **account owner** | once, at onboarding |
| (b) | `buildInitiateRecoveryCall({ account, controller }, newOwner, proof)` | **any relayer** (no owner key) | at recovery time |

(a) wraps `setAddrPrivilege(adapter, 0x..01)` inside `executeBySender` so the
owner authorizes the adapter as an Ambire executor. This is the *only* step that
needs the owner. (b) is sendable by anyone and asks the controller to verify the
method proof and rotate the signer — proving recovery never re-touches an owner
key.

## Exports

From `sdk/index.ts` (implementation in `sdk/recoveryAdapterClient.ts`):

**Calldata builders**
- `buildSetAdapterPrivilegeCall(account, adapter, priv?) -> Call` — inner
  `setAddrPrivilege` call (self-call-only on-chain; meant to be wrapped).
- `buildAuthorizeAdapterCall(account, adapter, priv?) -> Call` — **(a)** full
  owner-signed `executeBySender([setAddrPrivilege(adapter, 0x..01)])`.
- `buildInitiateRecoveryCall({ account, controller }, newOwner, proof?) -> Call`
  — **(b)** `controller.initiateRecovery(account, newOwner, proof)`.
- `buildRotateSignerCall(account, newOwner, priv?) -> Call` — the inner rotation
  call the *adapter* feeds to `executeBySender` (exposed for inspection/tests;
  the adapter normally builds this on-chain).

**Off-chain recoveryHash — (c)**
- `computeRecoveryHash({ newOwner, scheme?, nonce?, account?, chainId? }) -> Hex`
  — mirrors the controller's on-chain `keccak256(abi.encode(...))` so a method
  proof verifies. Pick `scheme` to match the deployed controller:
  - `'newOwnerNonce'` (default): `keccak256(abi.encode(newOwner, nonce))` —
    matches `IRecoveryMethod`'s "new-owner intent + per-account nonce" NatSpec
    and this PoC's intended replay-protected commitment.
  - `'accountNewOwnerChainId'`: `keccak256(abi.encode(account, newOwner,
    chainId))` — matches the trivial first-cut commitment the build plan
    sketches (`keccak256(abi.encode(account, newOwner, block.chainid))`).

**Shared encoders / constants**
- `encodeExecuteBySender(calls) -> Hex`, `encodeInitiateRecovery(...) -> Hex`
- `AMBIRE_ACCOUNT_ABI`, `RECOVERY_CONTROLLER_ABI` (minimal, verified fragments)
- `PRIV_AUTHORIZED` (`0x..01`), `PRIV_NONE` (`0x..00`)

**Optional runtime wiring**
- `class RecoveryClient` — `authorizeAdapter(wallet)`, `initiateRecovery(wallet,
  newOwner, proof?)`, `getPrivilege(key)`. The seam where a live `viem`
  provider plugs in. The PoC itself needs none of it.

**Types**
- `Call` (`{ to; value: bigint; data }` — field-compatible with on-chain
  `IAccountAdapter.Call` and Ambire `Transaction`), `RecoveryConfig`,
  `RecoveryHashScheme`.

## Verified correctness

The ABI fragments are taken from the firsthand Ambire source
(`deployless/IAmbireAccount.sol`, `libs/Transaction.sol`). Function selectors
were cross-checked against Foundry `cast`:

- `setAddrPrivilege(address,bytes32)` → `0x0d5828d4`
- `executeBySender((address,uint256,bytes)[])` → `0xabc5345e`
- `initiateRecovery(address,address,bytes)` → `0x7fabd0ab`

The off-chain `recoveryHash` (`computeRecoveryHash`, default scheme
`'controllerBound'`) encodes `keccak256(abi.encode(controller, chainId, account,
newOwner, nonce))` — the exact tuple `RecoveryControllerPoC._recoveryHash`
computes on-chain. This equality is enforced by the Foundry test
`test_RecoveryHashMatchesCanonicalSdkEncoding`, so the contract and SDK cannot
silently drift. (The other `RecoveryHashScheme` values are non-matching legacy
sketches — do not use them against the current controller.)

## Where this lives in the real SDK

| PoC artifact | Real Kohaku home |
|---|---|
| `recoveryAdapterClient.ts` builders (a)/(b) | `@kohaku-eth/recovery` — the client encoders the extension calls to onboard recovery and to submit a recovery request |
| `computeRecoveryHash` (c) | `@kohaku-eth/recovery` proof layer — must stay in lockstep with the on-chain controller/combinator commitment |
| `AMBIRE_ACCOUNT_ABI` host fragment | the host-adapter layer (`AmbireAccountAdapter`'s client side); a 7579 adapter ships its own fragment, the controller-facing builders stay identical |
| `RecoveryClient` | the extension's recovery controller / background service that holds a `viem` client and the `RecoveryConfig` |

The point: swapping the host (Ambire → ERC-7579 → Safe) changes only the
host-specific fragment and on-chain adapter. `buildInitiateRecoveryCall`,
`computeRecoveryHash`, and the controller ABI are host-agnostic and unchanged —
the same property the on-chain `IAccountAdapter` seam gives the contracts.

## Conventions / notes

- Pure calldata builders: no network calls, no private keys, no hardcoded
  addresses (every address is passed in via `RecoveryConfig` / args).
- Dependency: `viem` for encoding/keccak (mirrors the extension's stack). An
  `ethers` consumer can reuse the exported ABI fragments directly.
- `pq-account/js/` uses plain JS + `ethers` as call-encoders; this glue keeps
  that "thin encoders" spirit but is TypeScript + `viem` per the PoC brief.

### Typecheck

```sh
# from sdk/, after `npm install` (pulls viem + typescript)
npm run typecheck
```

During development this module was typechecked against the extension's existing
`viem` install with `strict` + `noUncheckedIndexedAccess` and passes clean.
