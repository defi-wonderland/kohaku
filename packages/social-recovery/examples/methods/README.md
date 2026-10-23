# Methods playground

A private sample package showing an integrator how the recovery methods of `@kohaku-eth/social-recovery` enrol a
credential, sign and verify, with no chain and no provider. It imports the SDK by its package name, exactly as an
integrator does, so the SDK must be built first. Every enrolment, signature and verdict goes through the SDK's methods
orchestrator, built with `SocialRecoveryBuilder.from({ chainId, descriptor }).withMethod(zkPassportMethod())
.withMethod(anonAadhaarMethod(…)).buildMethodsOrchestrator()` over a sample descriptor whose addresses are derived from
labels (nothing is deployed). The wallet and passkey methods are the builder's shipped defaults.

## Run

From the repository root:

```sh
pnpm install
pnpm --filter @kohaku-eth/social-recovery build
pnpm --filter @kohaku-eth/social-recovery-example-methods run enroll
pnpm --filter @kohaku-eth/social-recovery-example-methods run sign
pnpm --filter @kohaku-eth/social-recovery-example-methods run verify
pnpm --filter @kohaku-eth/social-recovery-example-methods dev    # the two pages
```

No environment variables are read. Every key is generated at run time; nothing is sent to any chain.

## Node scripts (run with `tsx`, wallet method only)

| Script | What it shows |
| --- | --- |
| `enroll` | A viem local account enrols by address: `orchestrator.enrollInput(walletModule, { address })`, then `configFrom(walletModule, input, undefined)` gives the config bytes; the credential line, its default salt and the hash a setup body commits to; the zero address, a malformed address and a ceremony input each refused with a typed failure. |
| `sign` | A setup of three wallet guardians, two needed. `placeMap` and `seed` build the gathering record, `requests` the approver requests. For two places: `orchestrator.signingInput(request)`, the guardian's `signTypedData`, `orchestrator.replyFrom(request, input, { signature })` (the reply), `fileReply`, and `count` until the rule is satisfied. Then one cancellation request, the same way. |
| `verify` | `orchestrator.verify(request, place, proof)`: satisfied for the guardian's own signature; rejected for an outsider's, for another guardian's and for a tampered signature; a typed failure from `replyFrom` for empty or missing material; not judged where the request says the guardian's address holds code; satisfied for a cancellation. |

## The two pages (Vite)

`pnpm … dev` serves two pages of one app; open them in two tabs of the same browser.

- **Holder page** (`index.html`): paste one credential line per guardian (any mix of methods), tick "holds code" for
  a place whose guardian address is a contract wallet, set the threshold and the wait, and make the requests: the
  sample setup (`configurationBody`), `placeMap`, `seed`, and one approval and one cancellation request line per place,
  each with Copy. Paste a reply line to file it: `fileReply`'s outcome, `count` after it, and `orchestrator.verify` for
  the filed reply. No wallet and no chain are needed; the requests carry the chain id field (31337 by default).
- **Approver page** (`approver.html`): pick a method, enrol (the credential line, with Copy), paste a request line
  (`orchestrator.describeRequest`, which also picks the request's method), sign it (the reply line, with Copy, and
  `orchestrator.verify`). A request naming a module this playground does not hold shows the orchestrator's refusal; such
  a request belongs on the client-flows approver page. The page builds for the connected wallet's chain, else 31337.

The three kinds of line are the SDK's records as JSON, one per line: a credential line is a `Credential`
(`{ "method", "config" }`), a request line an `ApproverRequest`, a reply line a `Reply`.

## Testing mode and real mode, per method

| Method | Testing mode (default on) | Real mode |
| --- | --- | --- |
| Wallet | A viem key generated in the page and kept in `localStorage` under a TEST-ONLY key; it signs with `signTypedData`. Verdict `satisfied`. | The injected wallet: Connect, then `eth_signTypedData_v4`. Switching account or chain drops the connection; a request for another chain than the wallet's is refused before the wallet is asked. |
| Passkey | A software P-256 authenticator in the page (its key and credential id in `localStorage`, TEST ONLY): it builds the creation record (CBOR attestation object, `fmt: none`, authenticator data with the COSE key) and the assertion (signature over authenticatorData ‖ sha256(clientDataJSON), DER) as a browser hands them over. Nothing about the passkey checks is simulated: the method checks them as for a real authenticator. Verdict `satisfied`. | `navigator.credentials.create` / `get` with the options the orchestrator returns, the relying-party id being this page's host (a passkey made on `localhost` does not serve a tunnel host). |
| zkPassport | None yet: real documents only. | The installed `@zkpassport/sdk`: the request URL shown as a link and as text for the zkPassport app on a phone, the six callbacks traced, a real passport or ID card. Verdict `not-judged` (only the chain's verifier checks the proof). |
| Aadhaar | anon-aadhaar's own test mode: a test QR from its generator, its test certificate (fetched from the URL the library names), a real proof, and a stack whose `verify` checks the proof against the test key. Verdict `satisfied`. | A real Aadhaar QR and the production certificate (pasted as PEM), under the method's default stack. |

The Aadhaar prover downloads its files from anon-aadhaar's published v2 bucket at the first proof (they are never
bundled): the circuit, about 10 MB, and the proving key, 612 MB (one download, or the published chunks with the
"chunked" switch). Proving then takes tens of seconds; the page shows the prover's progress and an Abort button. The
holder page fetches only the 4 KB verification key to verify an Aadhaar reply.

## Files

- `src/sample.ts` (the sample addresses and descriptor), `src/orchestrator.ts` (the orchestrator through the builder),
  `src/setup.ts` (the sample setup and gathering record), `src/constants.ts` (the sample values), `src/format.ts`.
- `src/enroll.ts`, `src/sign.ts`, `src/verify.ts`: the scripts.
- `src/web/holder/`: the holder page. `src/web/approver/`: the approver page, one file per method's material
  (`wallet.ts`, `passkey.ts` with `passkey-authenticator.ts`, `zkpassport.ts`, `aadhaar.ts`) and `flow.ts`.
- `src/web/shared/`: the line formats, the page helpers, the TEST-ONLY storage and the Aadhaar core loader;
  `src/web/session.ts` and `src/web/page.ts`: the wallet connection.
