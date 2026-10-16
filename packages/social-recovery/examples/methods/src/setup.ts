import {
  AmbireActionCodec,
  configurationBody,
  DIGEST_VERSION,
  encodeSetupBody,
  placeMap,
  seed,
  type Address,
  type Configuration,
  type Gathering,
  type GatheringMembers,
  type Hex,
  type IRecoveryMethod,
  type PlaceStanding,
  type Purpose,
  type SetupBody,
} from '@kohaku-eth/social-recovery';
import { getAddress, keccak256, slice, toHex } from 'viem';
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

/** A local address derived from a label, so the sample needs no deployment. */
export const localAddress = (label: string): Address => getAddress(slice(keccak256(toHex(label)), 12));

/** The sample's fixed addresses. */
export const SAMPLE = {
  account: localAddress(SAMPLE_LABELS.account),
  manager: localAddress(SAMPLE_LABELS.manager),
  action: localAddress(SAMPLE_LABELS.action),
  method: localAddress(SAMPLE_LABELS.method),
};

/** A setup and the body it commits to. */
export type SampleSetup = {
  readonly configuration: Configuration;
  readonly body: SetupBody;
};

/** Enrols one wallet guardian by address: `enrollInput` then `configFrom`, which needs no material. */
export async function enrollWallet(method: IRecoveryMethod, address: Address, trace: Trace): Promise<Hex> {
  const input = method.enrollInput({ address });
  const config = await method.configFrom(input, undefined);

  trace(`method.configFrom(method.enrollInput({ address: ${address} }), undefined)`, config);

  if (isFailure(config)) throw new Error(`enrolment refused: ${config.cause}`);

  return config;
}

/** One clause of wallet guardians, each credential on the default salt of its place. */
export async function sampleSetup(method: IRecoveryMethod, guardians: readonly Address[], trace: Trace): Promise<SampleSetup> {
  const credentials = [];

  for (const guardian of guardians) {
    credentials.push({ method: SAMPLE.method, config: await enrollWallet(method, guardian, trace) });
  }

  const configuration: Configuration = {
    clauses: [{ threshold: Math.min(SAMPLE_THRESHOLD, guardians.length), credentials }],
    wait: SAMPLE_WAIT,
    ignoresPause: false,
  };
  const body = configurationBody(configuration, SAMPLE.account);

  trace('configurationBody(configuration, account)', body);

  return { configuration, body };
}

/** The members a gathering of the given purpose starts from, its block pinned at `now`. */
function sampleMembers(body: SetupBody, purpose: Purpose, chainId: number, now: number): GatheringMembers {
  const shared = {
    chainId: String(chainId),
    manager: SAMPLE.manager,
    digestVersion: DIGEST_VERSION,
    account: SAMPLE.account,
    action: SAMPLE.action,
    attemptId: SAMPLE_ATTEMPT_ID,
    setupNonce: SAMPLE_SETUP_NONCE,
    setupBody: encodeSetupBody(body),
    validUntil: String(now + SAMPLE_WINDOW),
    block: { number: SAMPLE_BLOCK_NUMBER, timestamp: String(now), hash: keccak256(toHex(SAMPLE_LABELS.blockHash)) },
  };

  if (purpose === 'cancellation') {
    return { purpose, request: { ...shared, consumableAfter: String(now + SAMPLE_WAIT) } };
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

  const members = sampleMembers(setup.body, options.purpose, options.chainId ?? SAMPLE_CHAIN_ID, now);
  const record = seed(members, places);

  trace(`seed(members, places): the ${record.purpose} gathering, with ${record.places.length} places, no replies yet`);

  return record;
}
