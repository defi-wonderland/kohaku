# Social recovery: the client flows (sample app)

Node scripts and two browser pages that drive `@kohaku-eth/social-recovery` against the contracts deployed on Sepolia:
the holder's setup and recovery clients, built by `SocialRecoveryBuilder`, and the approver's methods orchestrator. The
package is private and never published; it consumes the SDK's built `dist`.

| Script | What it walks through |
| --- | --- |
| `setup` | draft → `validateSetup` → `describeSetup` → `prepareCommitSetup` → the account sends the batch → `confirmSetup` → `setupState` |
| `recovery` | `initRecoveryGathering` → `getApproverRequests` → the guardians sign → `addApproverReply` → `assess` → `complete` → `validateRequest` → `prepareStartAttempt` → the sponsor sends → the wait → `recoveryState` → `prepareExecuteHandover` → the sponsor sends |
| `cancel` | by owner (`prepareCancelByOwner`, sent by the account), then by proofs (`initCancelGathering` → the guardians sign → `complete` → `validateRequest` → `prepareCancelByProofs`, sent by the sponsor), each over an attempt it opens |
| `e2e` | `setup`, `recovery` and `cancel` in one run, asserting on the chain's answers; exits 1 on any failure |

Every script prints each SDK call, the findings, the prepared records and the transaction hashes. The SDK never signs
or sends: the scripts do, from the keys in the environment. The scripts' guardians are wallet guardians: each signs its
request through the kit's methods orchestrator (`signingInput` → the key signs the typed data → `replyFrom` → `verify`).

## Run

```sh
pnpm --filter @kohaku-eth/social-recovery build      # the scripts import the SDK's dist
cd packages/social-recovery/examples/clients
cp .env.example .env                                  # fill it in; .env is gitignored
pnpm run setup                                        # `pnpm setup` is pnpm's own command: use `pnpm run setup`
pnpm run recovery                                     # or: pnpm run recovery --two-step
pnpm run cancel
pnpm run e2e
pnpm run dev                                          # the pages (below): / is the holder, /approver.html the approver
```

Build the pages through Vite's JS API with an empty `envDir`, so no `VITE_` value of your `.env` is baked into the
output (the package's `build` script and a plain `vite build` read the `.env` and bake its `VITE_` values in):

```sh
pnpm --filter @kohaku-eth/social-recovery-example-clients exec tsc --noEmit
EMPTY_ENV="$(mktemp -d)"                               # a NEW empty directory every time, never a reused one
cd packages/social-recovery/examples/clients
node --input-type=module -e "import { build } from 'vite'; await build({ envDir: process.env.EMPTY_ENV, build: { outDir: '/tmp/clients-dist', emptyOutDir: true } });"
```

## The holder's account: three modes (`ACCOUNT_MODE`)

- `existing` (default): an Ambire account the holder key already holds (`ACCOUNT_ADDRESS`). The setup arms it: its first
  commit is one atomic batch, the account's privilege write for the action and the manager's `commitSetup`, sent by the
  holder as one `executeBySender` call to the account.
- `create`: the sample creates the account through Ambire's factory. Ambire's facts are inputs: the factory address
  (`AMBIRE_FACTORY`), the full creation code with the holder's privilege written in (`AMBIRE_CREATION_CODE`), the salt
  (`AMBIRE_SALT`) and the factory's deploy function (`AMBIRE_FACTORY_DEPLOY_FUNCTION`). The address is the `CREATE2`
  result; the sponsor sends the deploy when that address holds no code. This mode has not run yet.
- `eoa`: the holder's own address stands in for the account. The flows run the reads and the prepares and send no
  account self-call; the setup prints its findings (an EOA is not an account the action supports) and stops before
  sending, the recovery reads the state, the cancel prepares the owner's cancel without sending it.

## The wait: two modes

The setup commits `SETUP_WAIT` seconds (default 120). A wait under the client's short-wait threshold (48 hours) is
flagged with the SDK's `setup.wait-short` warning. The setup script prints it for the draft; the recovery script
prints it for the committed setup, restored from the backup, so a resumed attempt is described by the wait it runs on.

- Default: `pnpm run recovery` starts the attempt, polls the chain's clock until `consumableAfter`, then executes the
  handover in the same run, however long the wait; Ctrl-C stops it, and a later run resumes the waiting attempt.
- `--two-step`, the mode for a real wait: the first run starts the attempt and exits; run it again once the wait is over and it executes the
  waiting attempt. A run that finds an attempt waiting always resumes it rather than opening another.

## Variables

See `.env.example`; every variable carries a comment. In short:

| Variable | Meaning | Modes |
| --- | --- | --- |
| `SEPOLIA_RPC_URL` | the Sepolia endpoint; the run stops unless it answers chain id 11155111 | all |
| `MANAGER_ADDRESS`, `METHOD_ECDSA_ADDRESS`, `METHOD_PASSKEY_ADDRESS`, `ACTION_ADDRESS`, `AMBIRE_IMPLEMENTATION_ADDRESS`, `DEPLOY_BLOCK` | the deployment | all |
| `METHOD_AADHAAR_ADDRESS`, `METHOD_ZKPASSPORT_ADDRESS` | the identity methods, zero address when empty | all |
| `MANAGER_VERSION` | optional; the run stops when the manager's `version()` differs | all |
| `ACCOUNT_MODE` | `existing`, `create` or `eoa` | all |
| `ACCOUNT_ADDRESS` | the Ambire account | existing |
| `AMBIRE_FACTORY`, `AMBIRE_CREATION_CODE`, `AMBIRE_SALT`, `AMBIRE_FACTORY_DEPLOY_FUNCTION`, `AMBIRE_ACCOUNT_CREATED_AT` | Ambire's creation inputs | create |
| `HOLDER_PRIVATE_KEY`, `NEW_HOLDER_PRIVATE_KEY` | the key the account holds and the key a recovery hands it to; they swap after each handover | all |
| `SPONSOR_PRIVATE_KEY` | sends the permissionless calls | all |
| `GUARDIAN_PRIVATE_KEYS`, `GUARDIAN_THRESHOLD` | the wallet guardians (comma-separated) and how many the rule needs | all |
| `SETUP_WAIT`, `BACKUP_PASSWORD` | the committed wait and the encrypted backup's password | all |
| `ORDER_TOKEN`, `ORDER_AMOUNT`, `ORDER_PAYEE` | the payment order; the payee defaults to the sponsor | all |

The deployment descriptor is built from these with digest version `1`; the run reads the manager's `version()` and
EIP-712 domain at start and stops on a mismatch. The kit is then built by
`SocialRecoveryBuilder.from({ provider, account, descriptor, configuration }).withSignerRecovery(…).build()`, whose own
construction checks read the chain id, the manager's EIP-712 domain and `version()` once more; where the holder keys
swapped after a handover the kit is built again over the first build's manager reading. The client configuration is fixed in `src/clients.ts`: default and
short wait 48 hours, largest wait 30 days, a request window of 24 hours (floor 1 hour), a cancel window of 12 hours, a
rule cost bound of 10,000,000 gas, reads and watches at `latest`, log reads in chunks of 10,000 blocks, simulation on,
the holder key as the one candidate key and the order's token as the token allowlist.

## Funding

- The holder key and the new holder key: Sepolia ETH for the account's own calls (the commit, the owner's cancel).
  After a handover the account answers to the other key, so both need some.
- The sponsor: Sepolia ETH for every permissionless call (start, cancel by proofs, execute) and the mode `create` deploy.
- The account: the order's amount of `ORDER_TOKEN` when `ORDER_AMOUNT` is nonzero.
- The guardians only sign and need nothing.

## The pages

`pnpm run dev` serves both pages with Vite: `index.html`, the **holder** page, and `approver.html`, the **approver**
page, one app with two entries (the empty-`envDir` build above builds both). Each names its role and links the other. Open them in two
tabs of the same browser: the holder tab keeps its open gathering while you answer its requests in the approver tab.
Neither page holds a key; the `VITE_` variables only prefill their forms, and every `VITE_` value, the optional
`VITE_READ_RPC_URL` included, is visible in the served page.

Shared by both pages (`src/web/`): `wallet.ts` (the connection and its session checks), `connect.ts` and `chain.ts`
(Connect, the Sepolia switch, the wallet request timeouts), `lifetime.ts` (each action's lifetime), `actions.ts` (the
one-action-at-a-time runner each page wires its buttons to), `page.ts` (the page lookups, tolerant of the other page's
missing areas), `config.ts` (the form prefill and the field readers) and `src/trace.ts` (the trace).

### The holder page

The wallet must end up on Sepolia (chain id 11155111), or Connect refuses.
When the wallet is on another chain, Connect asks it to switch to Sepolia (`wallet_switchEthereumChain`), first adding
the chain (`wallet_addEthereumChain`, with a public Sepolia RPC and Etherscan) when the wallet does not know it; Connect
refuses only when you reject the switch or the wallet stays elsewhere.
Each Connect reads the wallet object the browser holds at that moment, shows "Connecting… confirm in your wallet" while
a request is pending, and reports a request the wallet has not answered in time (5 minutes for one you confirm, 60 seconds
for a read) as an error.
The page reads logs in chunks of 2,000 blocks (the scripts use 10,000), because the RPC nodes wallets read through refuse
wider `eth_getLogs` ranges on their free plans.

The Read RPC URL (optional, prefilled from `VITE_READ_RPC_URL`): some wallets' nodes refuse `eth_getLogs` with a topic
filter, or over more than about a hundred blocks, so the SDK's event scan from the deploy block fails through the
wallet. With the field set, Apply checks that the URL answers Sepolia's chain id and the page sends every chain read
(calls, logs, blocks, code, transactions, chain id, the order's native balance) to it through viem, at most two at a
time with a backoff on rate limits, while the wallet still connects, switches chain, signs, sends and polls receipts;
empty, the wallet answers everything as before. Use a public Sepolia endpoint or one with your own key; it lives only in
your gitignored `.env` or the form, never in a commit, and like every `VITE_` variable it is visible in the served page.

- **Deployment**: the manager, the methods, the action, the Ambire implementation, the deploy block, the factory and its
  deploy function, the optional manager version and the optional existing account. Each field is prefilled from the
  package's `.env` (the `VITE_` block of `.env.example`) and can be typed. **Apply** checks the descriptor against the
  chain as the scripts do (chain id, `version()`, the EIP-712 domain).
- **Holder**: the connected account is the account's signer and the sponsor; it sends every transaction.
  - Account: **Create** builds the account's creation code for the connected address (below), shows the predicted
    `CREATE2` address and the salt, and sends the factory's deploy when that address holds no code; **Select** takes the
    form's existing account (it must hold code; the account's own calls are refused unless the connected account is its
    authority); **EOA stand-in** uses the connected address for reads and prepares only. Choosing the account builds
    the kit through `SocialRecoveryBuilder.from({ provider, account, descriptor, configuration })` (the signer recovery
    handed over, then `.build()`), the configuration carrying the 2,000-block log chunks: the builder reads the chain id, the manager's EIP-712 domain and
    `version()`, through the Read RPC URL's cap and backoff when one is set. Every later action builds the kit again over
    its own lifetime with that first reading handed back, so it reads only the chain id, once per action.
  - State: `setupState()` and `recoveryState()`, read on demand.
  - Setup: one credential line per guardian, in any mix of the four methods: a credential line copied from the approver
    page's enrollment (the SDK's `Credential` record as JSON, `{ "method": …, "config": … }`, optional `label` and
    `salt`), or a bare address for a wallet guardian (its config built through the orchestrator's `configFrom` for the
    deployment's wallet method; addresses on one line may be separated by whitespace or commas). A credential whose
    module is not one of the applied deployment's four methods is refused, naming its line. Then one clause, the threshold, the wait (default 120 s) and the backup password →
    `validateSetup` → `describeSetup` → `prepareCommitSetup` → one `executeBySender` to the account → `confirmSetup`.
    The setup registers each guardian's real module and config on chain.
  - Attempt: the new authority (another of the wallet's accounts) and the payment order → `initRecoveryGathering` →
    each approver request as a JSON line with a Copy button → paste one reply line at a time (`addApproverReply`) →
    `assess` → `complete` → `validateRequest` → `prepareStartAttempt` → the wallet sends.
  - Execute: **Refresh** compares `consumableAfter` with the latest block's timestamp; **Execute** is enabled once the
    attempt is ripe and runs `prepareExecuteHandover`, then shows a check line for the consumed attempt, the moved keys,
    the action still authorized and, for a nonzero order, the payee's payment. Cancels stay in the `cancel` script.

### The approver page

Its Deployment block and the holder's descriptor need no chain read (the zkPassport SDK's own verifier may query a
chain or its API), it sends no transaction, and it carries **no testing material**: every answer and every enrollment
is made with real material, and the on-chain verifiers judge it.

- **Deployment**: a reduced block (the manager, the four methods, the action, the Ambire implementation, the deploy
  block, the optional manager version), prefilled from the same `VITE_` variables. The descriptor is built from it
  without a read (Sepolia's chain id, the SDK's digest version, the wallet and passkey methods as the shipped ones, the
  action as the audited one), and the orchestrator is
  `SocialRecoveryBuilder.from({ descriptor, deviceBindings }).withMethod(zkPassportMethod()).withMethod(anonAadhaarMethod({ artifacts })).buildMethodsOrchestrator()`.
- **Answer a request**: paste a request line, **Describe** shows `describeRequest` (the account, the new and the removed
  key, the order, the deadline, the chain and the manager); a request for another chain id, manager or action than the
  form's is refused before any signing input, device or wallet prompt; a request naming a module the form does not
  name is the orchestrator's refusal. The
  method is read from `request.method`, and **Answer** runs `signingInput` → the material → `replyFrom` and shows the
  reply line with a Copy button and the local `verify` verdict (`not-judged` for zkPassport, whose proof only the chain
  checks):
  - wallet: the connected account signs with `eth_signTypedData_v4`; a request naming another guardian is noted
    ("names guardian …, not the connected …"), and a wallet switch during the signature shows nothing;
  - passkey: `navigator.credentials.get` with this page's host as the relying-party id (so serve the page on the host
    the passkey was created on), optionally limited to one credential id;
  - zkPassport: the installed `@zkpassport/sdk` opens the request and the page shows its URL as a link to open on the
    phone holding the zkPassport app (no QR code: no QR package is installed); the six callbacks are traced; a real
    passport or identity card proves in the app, scoped to the domain and scope the request's config fixes;
  - Aadhaar: paste the data of a real secure QR code and UIDAI's production certificate (PEM, pasted or loaded from its
    file); the prover downloads anon-aadhaar's published v2 proving files at run time (the whole zkey from the server,
    or the chunked zkey as the fallback), shows its progress, and **Abort** stops it.
- **Enroll as a guardian**: the chosen method's `enrollInput` → real material (the connected account, a new passkey
  through `navigator.credentials.create`, a zkPassport proof verified by the installed SDK, an Aadhaar proof over the
  QR code) → `configFrom` → the credential line with a Copy button, to paste into the holder page's setup form.

Roles: switch accounts in the wallet between the guardian and the holder. Each action reads the connected account when
it starts and names it in its output. Any switch drops the connection (connect again). A chain switch also drops the
holder's applied deployment, the chosen account and the open gathering, while an account switch keeps them, so the
holder can sign as a wallet guardian in the approver tab and come back to the same gathering. A step the wallet switched
under stops before anything is shown, filed or sent. The forms and pasted texts always stay.

The creation code: one privilege entry (`PUSH1 0x01`, `PUSH32 slot`, `SSTORE`, with
`slot = keccak256(abi.encode(signer, uint256(0)))` for the connected address), then the minimal proxy's deploy code and
runtime over the Ambire implementation, all from the SDK's public `FORMATS_CREATION_*` constants. The page checks its
own bytes with the SDK's `creationPrivileges` (one entry, that slot, value 1) before anything is sent. The salt is drawn
at random (`crypto.getRandomValues`); type one to re-use it. **Create** on an address that already holds code uses that account
but keeps no creation record, since the page does not know the block it was created in.

Never in the bundle: Vite exposes every `VITE_` variable to the browser, so no private key may carry that prefix, and
any `VITE_` endpoint such as `VITE_READ_RPC_URL` is visible to whoever opens the page. `src/env.ts` (the scripts' keys and RPC URL) is not imported by either page. No proving file is bundled: the
Aadhaar files are downloaded by the prover when it first runs.

## Files

- `src/env.ts` loads and checks the environment; `src/provider.ts` is the viem-backed `IProvider`;
  `src/signer-recovery.ts` names the holder as the sender of a transaction to the account.
- `src/clients.ts` builds the descriptor, the configuration and the kit through `SocialRecoveryBuilder`, beside the
  sample's own check reads (the action state, the notifications, the payload decoding); `src/session.ts` opens a run.
- `src/account.ts` provides the account in its mode; `src/send.ts` sends prepared calls from the sponsor or the account.
- `src/guardians.ts` lets the wallet guardians answer through the kit's methods orchestrator; `src/draft.ts` builds
  their credentials through it.
- `src/validation.ts` assembles the request validation context and runs `validateRequest` before every submission.
- `src/setup.ts`, `src/recovery.ts` (`src/attempt.ts`, `src/handover.ts`), `src/cancel.ts`, `src/e2e.ts`: the flows.
- `src/trace.ts` prints the trace, to the console or, on the page, to its trace area; `src/run.ts` runs a script's entry.
- `index.html` and `src/web/main.ts`: the holder page. `provider.ts` and `revert.ts` are the wallet's `IProvider`,
  `reads.ts`, `endpoint.ts` and `throttle.ts` the Read RPC URL, `kit.ts` the kit, `creation.ts` the account's creation
  code, `send.ts` the transactions, `credentials.ts` the setup form's credential lines, and `account.ts`, `setup.ts`,
  `attempt.ts`, `execute.ts` the panels.
- `approver.html` and `src/web/approver.ts`: the approver page. `approver-deployment.ts` is the descriptor and the
  orchestrator, `describe-request.ts` the description, `guardian.ts` the answer per method, `enroll.ts` the
  enrollment, `devices.ts` the passkey and zkPassport ceremonies and the Abort, `aadhaar.ts` and `zkpassport.ts` the
  two identity methods' fields.
