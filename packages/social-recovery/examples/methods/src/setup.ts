import {
  AmbireActionCodec,
  configurationBody,
  encodeSetupBody,
  placeMap,
  seed,
  DIGEST_VERSION,
  type Address,
  type Configuration,
  type Credential,
  type Gathering,
  type GatheringMembers,
  type IMethodsOrchestrator,
  type PlaceStanding,
  type Purpose,
  type SetupBody,
} from '@kohaku-eth/social-recovery';
import { keccak256, toHex } from 'viem';
import {
  SAMPLE_ATTEMPT_ID,
  SAMPLE_BLOCK_NUMBER,
  SAMPLE_CHAIN_ID,
  SAMPLE_LABELS,
  SAMPLE_ORDER_AMOUNT,
  SAMPLE_SETUP_NONCE,
  SAMPLE_THRESHOLD,
  SAMPLE_WAIT,
  SAMPLE_WINDOW,
  SAMPLE_ZERO_ADDRESS,
} from './constants';
import { isFailure, type Trace } from './format';
import { localAddress, SAMPLE } from './sample';

/** A setup and the body it commits to. */
export type SampleSetup = {
  readonly configuration: Configuration;
  readonly body: SetupBody;
};

/** Enrols one wallet guardian by address through the orchestrator: `enrollInput`, then `configFrom` with no material. */
export async function enrollWallet(orchestrator: IMethodsOrchestrator, address: Address, trace: Trace): Promise<Credential> {
  const module = SAMPLE.methods.wallet;
  const input = orchestrator.enrollInput(module, { address });
  const config = await orchestrator.configFrom(module, input, undefined);

  trace(`orchestrator.configFrom(walletModule, orchestrator.enrollInput(walletModule, { address: ${address} }), undefined)`, config);

  if (isFailure(config)) throw new Error(`enrolment refused: ${config.cause}`);

  return { method: module, config };
}

/** The rule of a sample setup: how many approvals it needs and its wait. */
export type SetupOptions = {
  readonly threshold?: number;
  /** In seconds. */
  readonly wait?: number;
};

/** One clause over the credentials, any mix of methods, each on the default salt of its place. */
export function sampleSetup(credentials: readonly Credential[], trace: Trace, options: SetupOptions = {}): SampleSetup {
  const configuration: Configuration = {
    clauses: [{ threshold: Math.min(options.threshold ?? SAMPLE_THRESHOLD, credentials.length), credentials }],
    wait: options.wait ?? SAMPLE_WAIT,
    ignoresPause: false,
  };
  const body = configurationBody(configuration, SAMPLE.account);

  trace('configurationBody(configuration, account)', body);

  return { configuration, body };
}

/** The members a gathering of the given purpose starts from, its block pinned at `now`. */
function sampleMembers(setup: SampleSetup, purpose: Purpose, chainId: number, now: number): GatheringMembers {
  const shared = {
    chainId: String(chainId),
    manager: SAMPLE.manager,
    digestVersion: DIGEST_VERSION,
    account: SAMPLE.account,
    action: SAMPLE.action,
    attemptId: SAMPLE_ATTEMPT_ID,
    setupNonce: SAMPLE_SETUP_NONCE,
    setupBody: encodeSetupBody(setup.body),
    validUntil: String(now + SAMPLE_WINDOW),
    block: { number: SAMPLE_BLOCK_NUMBER, timestamp: String(now), hash: keccak256(toHex(SAMPLE_LABELS.blockHash)) },
  };

  if (purpose === 'cancellation') {
    return { purpose, request: { ...shared, consumableAfter: String(now + setup.configuration.wait) } };
  }

  const payload = new AmbireActionCodec([SAMPLE.action]).encode({
    newAuthority: localAddress(SAMPLE_LABELS.newAuthority),
    removedAuthority: localAddress(SAMPLE_LABELS.removedAuthority),
  });
  const order = { token: SAMPLE_ZERO_ADDRESS, amount: SAMPLE_ORDER_AMOUNT, payee: SAMPLE_ZERO_ADDRESS } as const;

  return { purpose, request: { ...shared, payload, order } };
}

/** Options of one sample gathering. */
export type GatheringOptions = {
  readonly purpose: Purpose;
  readonly chainId?: number;
  /** Places whose guardian address holds code, as an init would have read it. */
  readonly holdingCode?: readonly number[];
};

/** The gathering record: `placeMap` over the setup, then `seed` with the request members. */
export function sampleGathering(setup: SampleSetup, options: GatheringOptions, trace: Trace): Gathering {
  const now = Math.floor(Date.now() / 1000);
  const total = setup.body.clauses.reduce((sum, clause) => sum + clause.credentials.length, 0);
  const standings: PlaceStanding[] = Array.from({ length: total }, (_, place) => ({
    standing: 'not-stopped',
    stoppable: false,
    credentialHoldsCode: options.holdingCode?.includes(place) ?? false,
  }));
  const places = placeMap(setup.body, setup.configuration, standings, SAMPLE.account);

  trace('placeMap(body, configuration, standings, account)', places);

  const members = sampleMembers(setup, options.purpose, options.chainId ?? SAMPLE_CHAIN_ID, now);
  const record = seed(members, places);

  trace(`seed(members, places): the ${record.purpose} gathering, with ${record.places.length} places, no replies yet`);

  return record;
}
