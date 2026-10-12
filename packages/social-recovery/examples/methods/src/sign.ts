import { count, fileReply, requests, walletMethod, type Gathering } from '@kohaku-eth/social-recovery';
import { hashTypedData, type TypedDataDefinition } from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { ctxFor, replyFor } from './approver';
import { SAMPLE_WINDOW_BOUNDS } from './constants';
import { consoleTrace as trace, isFailure } from './format';
import { sampleGathering, sampleSetup } from './setup';

// Three wallet guardians, two of three needed; each approver signs its own place's request with no chain.
const method = walletMethod();
const guardians = [0, 1, 2].map(() => privateKeyToAccount(generatePrivateKey()));

trace('guardians (viem local accounts, keys generated for this run)', guardians.map((guardian) => guardian.address));

const setup = await sampleSetup(method, guardians.map((guardian) => guardian.address), trace);

/** One approver's side: ctx, signing input, the wallet's signature, the proof and the reply, filed into the record. */
async function approve(record: Gathering, guardian: PrivateKeyAccount, place: number): Promise<Gathering> {
  const request = requests(record)[place];

  if (request === undefined) throw new Error(`no request for place ${place}`);

  trace(`requests(record)[${place}]: what the approver at place ${place} receives`, request);

  const ctx = ctxFor(request);
  const input = method.signingInput(ctx);

  trace('ctxFor(request).digest', ctx.digest);
  trace('method.signingInput(ctx): the typed data the wallet signs', input);

  const typedData = input as unknown as TypedDataDefinition;

  trace('hashTypedData(input) equals ctx.digest', hashTypedData(typedData) === ctx.digest);

  const signature = await guardian.signTypedData(typedData);

  trace('guardian.signTypedData(input)', signature);

  const proof = await method.replyFrom(ctx, input, { signature });

  trace('method.replyFrom(ctx, input, { signature }): the proof bytes', proof);

  if (isFailure(proof)) throw new Error(`reply refused: ${proof.cause}`);

  const reply = replyFor(ctx, proof);

  trace('replyFor(ctx, proof): the reply sent back', reply);

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
