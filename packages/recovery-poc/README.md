# Recovery-Adapter PoC

A proof-of-concept proving **one** thing: an external, ERC-7579-executor-style
controller can drive the **existing Ambire smart account** to rotate its signer,
**without putting any recovery logic inside an Ambire validator**. The bridge is a
thin, swappable **account adapter**. This de-risks the central Kohaku thesis:
*"recovery built once in the SDK as 7579; the Ambire account reached via a thin
adapter."*

## What this proves / does NOT prove

**Proves (the adapter / execution bridge):**

- An external contract (`AmbireAccountAdapter`), once granted a privilege on the
  account, can make the **real, unmodified `AmbireAccount`** execute a signer
  rotation via its native `executeBySender` primitive — Ambire's analogue of
  ERC-7579 `executeFromExecutor`.
- The rotation happens with **no owner signature** and with the call submitted by an
  arbitrary relayer: authorization flows from a recovery method, not from a
  privileged key signing the transaction.
- The recovery **controller depends only on `IAccountAdapter` / `IRecoveryMethod`**
  and never imports an Ambire type — so the identical controller can drive any host
  for which an adapter exists. The Ambire adapter is just one implementation.
- Ambire's **anti-bricking** invariant is respected: the adapter keeps its own
  privilege non-zero across the call, so `executeBySender` does not revert.

**Does NOT prove (out of scope, deliberately):**

- The real recovery **policy**. The policy here is a trivial placeholder:
  `RecoveryControllerPoC` consults a single `IRecoveryMethod` (`AlwaysValidMethod`,
  which always attests `true`) with effectively zero timelock. The real,
  **audit-gated** piece is an OR-over-AND combinator with per-method thresholds and
  timelocks. It slots into `RecoveryControllerPoC.initiateRecovery` (the verify step)
  **without touching `IAccountAdapter` or `IRecoveryMethod`**.
- Any real cryptography (guardian signatures, DKIM email, passkeys). `AlwaysValidMethod`
  is a stand-in and must never reach production.

> **The policy is trivial on purpose.** This PoC tests the **execution seam**, not the
> combinator. Read every "policy" reference in the source as a placeholder marking
> where the real, separately-audited logic lands.

## How to run

```sh
make install        # foundryup + `forge install` forge-std
make test           # forge test -vvv  (optimized profile, solc 0.8.19 / paris)
make test_lite      # same, optimizer off
```

Or directly:

```sh
forge test -vvv
```

## Layout

```
src/
  interfaces/
    IRecoveryMethod.sol      # verifier interface (Parti-shaped): verify(account, recoveryHash, proof) -> bool
    IAccountAdapter.sol      # the host-agnostic execution seam the controller depends on
  methods/
    AlwaysValidMethod.sol    # trivial IRecoveryMethod (returns true) — PoC only
  adapters/
    AmbireAccountAdapter.sol # IAccountAdapter impl: drives the account via executeBySender
  RecoveryControllerPoC.sol  # trivial policy: verify method -> ask adapter to rotate signer
test/
  harness/                   # deployable AmbireAccount wrapper (seeds initial privilege)
  ambire/                    # VENDORED Ambire sources (see below) — test-only
  *.t.sol                    # end-to-end + negative tests
```

The deployable `src/` surface imports **only** the two interfaces, except for
`AmbireAccountAdapter`, which is the single place any Ambire-specific knowledge
lives — and even there it depends on a **minimal locally-declared `IAmbireAccount`
interface** (`executeBySender` / `setAddrPrivilege` / `privileges`), not the full
account contract.

## Vendored Ambire sources

The Ambire contracts are **copied** into `test/ambire/` (test-only) rather than
remapped into the live extension tree, and the `ambire/` remapping points there:

```
ambire/=test/ambire/        # see remappings.txt
```

Source of truth:
`kohaku-extension/src/ambire-common/contracts`. The files are copied **unmodified**,
preserving their internal relative imports (`./libs/...`, `./deployless/...`) so the
real `AmbireAccount` compiles against the vendored tree exactly as it does upstream.

Minimal copied set (only what `AmbireAccount` needs to compile):

- `AmbireAccount.sol`, `AmbireFactory.sol`, `ExternalSigValidator.sol`
- `deployless/IAmbireAccount.sol`
- `libs/Transaction.sol`, `libs/SignatureValidator.sol`, `libs/Bytes.sol`,
  `libs/Eip712HashBuilder.sol`
- `libs/erc4337/PackedUserOperation.sol`, `libs/erc4337/UserOpHelper.sol`

**Why copy, not remap to the extension repo:**

1. **Self-contained & reproducible** — the package builds from a fresh clone / CI
   without depending on a sibling repo's path.
2. **Pin stability** — the copy freezes the exact Ambire bytes the PoC was proven
   against; the extension repo can move without silently changing "the real Ambire
   account" under the test.
3. **Compiler isolation** — the PoC pins `0.8.19` / `paris`; a copy under this
   package's own `foundry.toml` guarantees a clean, drift-free compile.
4. **No write coupling** — the canonical Ambire source is never at risk of edits.

> The vendored `AmbireAccount` is the real, audited executor logic. The only
> Ambire-derived addition is the test harness in `test/harness/` (which lives
> **outside** `test/ambire/`), needed because `AmbireAccount` has **no constructor**
> and seeds `privileges` via SSTORE-injected proxy bytecode in production — a path a
> forge unit test cannot run cleanly.

## Why a harness is needed (deployment note)

`AmbireAccount` intentionally has **no constructor** and cannot self-initialize a
valid `privileges` entry; production seeds it via proxy bytecode (`DeployHelper.sol`
+ `AmbireFactory`). The test harness seeds the initial owner privilege in its
constructor (which runs *as the account*, satisfying the `setAddrPrivilege` self-call
invariant) while inheriting the **real** `executeBySender` / `setAddrPrivilege` /
anti-bricking logic. The executor surface under test is byte-for-byte the audited
Ambire code; only the deployment seed differs from production.

## The recovery flow (two SDK touch-points)

1. **Authorize (once, owner-signed — onboarding, not recovery):** the owner makes the
   account self-call `setAddrPrivilege(adapter, 1)`, granting the adapter executor
   rights. This is the only owner signature in the whole story.
2. **Recover (no owner):** anyone (a relayer) calls
   `RecoveryControllerPoC.initiateRecovery(account, newOwner, proof)`. The controller
   verifies the method, then asks the adapter to `rotateSigner`, which drives the
   account through `executeBySender([setAddrPrivilege(newOwner, 1)])`. `newOwner` is
   now an authorized signer — recovered without the old key ever signing.
