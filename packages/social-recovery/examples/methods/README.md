# Methods playground

A private sample package showing an integrator how a recovery method of `@kohaku-eth/social-recovery` enrols a
credential, signs, and verifies, with no chain and no provider. It imports the SDK by its package name, exactly as an
integrator does, so the SDK must be built first. Today it covers the wallet method (`walletMethod()`).

## Run

From the repository root:

```sh
pnpm install
pnpm --filter @kohaku-eth/social-recovery build
pnpm --filter @kohaku-eth/social-recovery-example-methods run enroll
pnpm --filter @kohaku-eth/social-recovery-example-methods run sign
pnpm --filter @kohaku-eth/social-recovery-example-methods run verify
pnpm --filter @kohaku-eth/social-recovery-example-methods dev    # the browser page
```

No environment variables are read. Every key is generated at run time; nothing is sent anywhere.

## Node scripts (run with `tsx`)

| Script | What it shows |
| --- | --- |
| `enroll` | A viem local account enrols by address: `enrollInput({ address })`, then `configFrom(input, undefined)` gives the config bytes; the credential, its default salt and the hash a setup body commits to; the zero address, a malformed address and a ceremony input each refused with a typed failure. |
| `sign` | A setup of three wallet guardians, two needed. `placeMap` and `seed` build the gathering record, `requests` the approver requests. For two places: the ctx, `signingInput(ctx)`, the guardian's `signTypedData`, `replyFrom(ctx, input, { signature })`, the reply, `fileReply`, and `count` until the rule is satisfied. Then one cancellation request, the same way. |
| `verify` | `verify(ctx, proof)`: satisfied for the guardian's own signature; rejected for an outsider's, for another guardian's and for a tampered signature; a typed failure from `replyFrom` for empty or missing material; not judged where the request says the guardian's address holds code; satisfied for a cancellation. |

## The page (Vite)

`pnpm … dev` serves `index.html`. With a browser wallet installed, **Connect wallet** enrols the connected address at
place 0 of a sample setup (beside two generated guardians) and shows the approver request for that place; **Sign the
approval** asks the wallet through `eth_signTypedData_v4`, builds the proof and the reply, and shows `verify`'s answer.
Connect also reads the address's code (`eth_getCode`) and shows `credentialHoldsCode`: an address holding code (a
contract wallet) gets `not-judged` from `verify`, which does not judge its signature locally, while a plain account gets
`satisfied` or `rejected`. Switching account or chain in the wallet drops the connection, the request and the verdict;
connect again. Connect reads the account and chain a second time once both answered, and refuses the connection if
either changed meanwhile. The request's domain uses the wallet's current chain id, since wallets refuse typed data for another
chain, whereas the Node scripts use chain id 31337; nothing is sent to any chain.

## Files

- `src/approver.ts` builds each place's `Ctx` and the `Reply` from the SDK's public functions. The SDK's methods
  orchestrator will build both; this file goes away when it ships.
- `src/setup.ts` builds the sample setup and gathering record; `src/constants.ts` holds the sample values.
- `src/enroll.ts`, `src/sign.ts`, `src/verify.ts` are the scripts; `src/web/main.ts` is the page.
