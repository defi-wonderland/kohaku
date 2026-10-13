# Social recovery: the client flows (sample app)

Node scripts and a browser page that drive `@kohaku-eth/social-recovery`'s setup and recovery clients against the
contracts deployed on Sepolia. The package is private and never published; it consumes the SDK's built `dist`.

| Script | What it walks through |
| --- | --- |
| `setup` | draft → `validateSetup` → `describeSetup` → `prepareCommitSetup` → the account sends the batch → `confirmSetup` → `setupState` |
| `recovery` | `initRecoveryGathering` → `getApproverRequests` → the guardians sign → `addApproverReply` → `assess` → `complete` → `validateRequest` → `prepareStartAttempt` → the sponsor sends → the wait → `recoveryState` → `prepareExecuteHandover` → the sponsor sends |
| `cancel` | by owner (`prepareCancelByOwner`, sent by the account), then by proofs (`initCancelGathering` → the guardians sign → `complete` → `validateRequest` → `prepareCancelByProofs`, sent by the sponsor), each over an attempt it opens |
| `e2e` | `setup`, `recovery` and `cancel` in one run, asserting on the chain's answers; exits 1 on any failure |

Every script prints each SDK call, the findings, the prepared records and the transaction hashes. The SDK never signs
or sends: the scripts do, from the keys in the environment.

## Run

```sh
pnpm --filter @kohaku-eth/social-recovery build      # the scripts import the SDK's dist
cd packages/social-recovery/examples/clients
cp .env.example .env                                  # fill it in; .env is gitignored
pnpm run setup                                        # `pnpm setup` is pnpm's own command: use `pnpm run setup`
pnpm run recovery                                     # or: pnpm run recovery --two-step
pnpm run cancel
pnpm run e2e
pnpm run dev                                          # the page (below)
pnpm build                                            # tsc --noEmit, then vite build
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
EIP-712 domain at start and stops on a mismatch. The client configuration is fixed in `src/clients.ts`: default and
short wait 48 hours, largest wait 30 days, a request window of 24 hours (floor 1 hour), a cancel window of 12 hours, a
rule cost bound of 10,000,000 gas, reads and watches at `latest`, log reads in chunks of 10,000 blocks, simulation on,
the holder key as the one candidate key and the order's token as the token allowlist.

## Funding

- The holder key and the new holder key: Sepolia ETH for the account's own calls (the commit, the owner's cancel).
  After a handover the account answers to the other key, so both need some.
- The sponsor: Sepolia ETH for every permissionless call (start, cancel by proofs, execute) and the mode `create` deploy.
- The account: the order's amount of `ORDER_TOKEN` when `ORDER_AMOUNT` is nonzero.
- The guardians only sign and need nothing.

## The page

`pnpm run dev` serves `index.html` with Vite. It drives the same clients through the connected browser wallet: the
wallet answers every read (an `IProvider` over its EIP-1193 `request`) and sends every transaction. The page holds no
key and no RPC URL of its own; the wallet must end up on Sepolia (chain id 11155111), or Connect refuses.
When the wallet is on another chain, Connect asks it to switch to Sepolia (`wallet_switchEthereumChain`), first adding
the chain (`wallet_addEthereumChain`, with a public Sepolia RPC and Etherscan) when the wallet does not know it; Connect
refuses only when you reject the switch or the wallet stays elsewhere.
Each Connect reads the wallet object the browser holds at that moment, shows "Connecting… confirm in your wallet" while
a request is pending, and reports a request the wallet has not answered within 60 seconds as an error.

- **Deployment**: the manager, the methods, the action, the Ambire implementation, the deploy block, the factory and its
  deploy function, the optional manager version and the optional existing account. Each field is prefilled from the
  package's `.env` (the `VITE_` block of `.env.example`) and can be typed. **Apply** checks the descriptor against the
  chain as the scripts do (chain id, `version()`, the EIP-712 domain) and builds the parts and both clients.
- **Holder**: the connected account is the account's signer and the sponsor; it sends every transaction.
  - Account: **Create** builds the account's creation code for the connected address (below), shows the predicted
    `CREATE2` address and the salt, and sends the factory's deploy when that address holds no code; **Select** takes the
    form's existing account (it must hold code; the account's own calls are refused unless the connected account is its
    authority); **EOA stand-in** uses the connected address for reads and prepares only.
  - State: `setupState()` and `recoveryState()`, read on demand.
  - Setup: guardian addresses, one clause, the threshold, the wait (default 120 s) and the backup password →
    `validateSetup` → `describeSetup` → `prepareCommitSetup` → one `executeBySender` to the account → `confirmSetup`.
  - Attempt: the new authority (another of the wallet's accounts) and the payment order → `initRecoveryGathering` →
    each approver request as JSON with a Copy button → paste one reply at a time (`addApproverReply`) → `assess` →
    `complete` → `validateRequest` → `prepareStartAttempt` → the wallet sends.
  - Execute: **Refresh** compares `consumableAfter` with the latest block's timestamp; **Execute** is enabled once the
    attempt is ripe and runs `prepareExecuteHandover`, then shows a check line for the consumed attempt, the moved keys,
    the action still authorized and, for a nonzero order, the payee's payment. Cancels stay in the `cancel` script.
- **Guardian**: paste an approver request, sign it with the connected account (`eth_signTypedData_v4`), copy the reply
  into the holder panel. The local `verify` verdict is shown.

Roles: switch accounts in the wallet between the guardian and the holder. Each action reads the connected account when
it starts and names it in its output. Any switch drops the connection (connect again). A chain switch also drops the
applied deployment, the chosen account and the open gathering, while an account switch keeps them, so the holder can
sign as a guardian and come back to the same gathering. A step the wallet switched under stops before anything is
shown, filed or sent. The forms and pasted texts always stay.

The creation code: one privilege entry (`PUSH1 0x01`, `PUSH32 slot`, `SSTORE`, with
`slot = keccak256(abi.encode(signer, uint256(0)))` for the connected address), then the minimal proxy's deploy code and
runtime over the Ambire implementation, all from the SDK's public `FORMATS_CREATION_*` constants. The page checks its
own bytes with the SDK's `creationPrivileges` (one entry, that slot, value 1) before anything is sent. The salt is drawn
at random (`crypto.getRandomValues`); type one to re-use it. **Create** on an address that already holds code uses that account
but keeps no creation record, since the page does not know the block it was created in.

Never in the bundle: Vite exposes every `VITE_` variable to the browser, so no private key and no RPC URL may carry that
prefix. `src/env.ts` (the scripts' keys and RPC URL) is not imported by the page.

## Files

- `src/env.ts` loads and checks the environment; `src/provider.ts` is the viem-backed `IProvider`;
  `src/signer-recovery.ts` names the holder as the sender of a transaction to the account.
- `src/clients.ts` builds the descriptor, the configuration, the parts and both clients; `src/session.ts` opens a run.
- `src/account.ts` provides the account in its mode; `src/send.ts` sends prepared calls from the sponsor or the account.
- `src/guardians.ts` builds each guardian's ctx and reply; the SDK's methods orchestrator replaces it later.
- `src/validation.ts` assembles the request validation context and runs `validateRequest` before every submission.
- `src/setup.ts`, `src/recovery.ts` (`src/attempt.ts`, `src/handover.ts`), `src/cancel.ts`, `src/e2e.ts`: the flows.
- `src/trace.ts` prints the trace, to the console or, on the page, to its trace area; `src/run.ts` runs a script's entry.
- `index.html` and `src/web/`: the page. `wallet.ts` is the connection and its session checks, `provider.ts` and
  `revert.ts` the wallet's `IProvider`, `config.ts` the deployment form, `kit.ts` the parts and clients, `creation.ts`
  the account's creation code, `send.ts` the transactions, and `account.ts`, `setup.ts`, `attempt.ts`, `execute.ts`,
  `guardian.ts` the panels; `main.ts` wires the buttons.
