import { count, fileReply, requests, type Credential, type Gathering } from '@kohaku-eth/social-recovery';
import { hashTypedData, type TypedDataDefinition } from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { SAMPLE_CHAIN_ID, SAMPLE_WINDOW_BOUNDS } from './constants';
import { consoleTrace as trace, isFailure } from './format';
import { buildOrchestrator } from './orchestrator';
import { enrollWallet, sampleGathering, sampleSetup } from './setup';

// Three wallet guardians, two of three needed; each approver signs its own place's request with no chain.
const orchestrator = buildOrchestrator(SAMPLE_CHAIN_ID);
const guardians = [0, 1, 2].map(() => privateKeyToAccount(generatePrivateKey()));

trace('guardians (viem local accounts, keys generated for this run)', guardians.map((guardian) => guardian.address));

const credentials: Credential[] = [];

for (const guardian of guardians) credentials.push(await enrollWallet(orchestrator, guardian.address, trace));

const setup = sampleSetup(credentials, trace);

/** One approver's side through the orchestrator: signing input, the wallet's signature and the reply, filed into the record. */
async function approve(record: Gathering, guardian: PrivateKeyAccount, place: number): Promise<Gathering> {
  const request = requests(record)[place];

  if (request === undefined) throw new Error(`no request for place ${place}`);

  trace(`requests(record)[${place}]: what the approver at place ${place} receives`, request);

  const input = orchestrator.signingInput(request);

  trace('orchestrator.signingInput(request): the typed data the wallet signs', input);

  const typedData = input as unknown as TypedDataDefinition;
  const signature = await guardian.signTypedData(typedData);

  trace('guardian.signTypedData(input)', signature);

  const reply = await orchestrator.replyFrom(request, input, { signature });

  trace('orchestrator.replyFrom(request, input, { signature }): the reply sent back', reply);

  if (isFailure(reply)) throw new Error(`reply refused: ${reply.cause}`);

  trace('hashTypedData(input) equals reply.digest', hashTypedData(typedData) === reply.digest);

  const filed = fileReply(record, reply);

  trace('fileReply(record, reply).outcome', filed.outcome);

  return filed.gathering;
}

let approval = sampleGathering(setup, { purpose: 'approval' }, trace);

for (const place of [0, 1]) {
  approval = await approve(approval, guardians[place] as PrivateKeyAccount, place);

  const assessment = count(approval, Math.floor(Date.now() / 1000), SAMPLE_WINDOW_BOUNDS);

  trace(`count(record, now, bounds) after place ${place}`, assessment);
}

// The same ceremony for a cancellation: the request carries no payload and no order.
const cancellation = sampleGathering(setup, { purpose: 'cancellation' }, trace);

await approve(cancellation, guardians[2] as PrivateKeyAccount, 2);
