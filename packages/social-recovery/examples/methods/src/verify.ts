import { requests, type ApproverRequest, type Credential, type Hex } from '@kohaku-eth/social-recovery';
import type { TypedDataDefinition } from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { SAMPLE_CHAIN_ID } from './constants';
import { consoleTrace as trace, isFailure } from './format';
import { buildOrchestrator } from './orchestrator';
import { enrollWallet, sampleGathering, sampleSetup } from './setup';

// The method's local check over a proof, through the orchestrator: satisfied, rejected or not judged, with no chain read.
const orchestrator = buildOrchestrator(SAMPLE_CHAIN_ID);
const guardians = [0, 1, 2].map(() => privateKeyToAccount(generatePrivateKey()));
const outsider = privateKeyToAccount(generatePrivateKey());

trace('guardians (viem local accounts, keys generated for this run)', guardians.map((guardian) => guardian.address));
trace('an outsider, enrolled nowhere', outsider.address);

const credentials: Credential[] = [];

for (const guardian of guardians) credentials.push(await enrollWallet(orchestrator, guardian.address, () => undefined));

const setup = sampleSetup(credentials, trace);

/** The request for one place of a fresh gathering. */
function requestAt(place: number, purpose: 'approval' | 'cancellation', holdingCode: readonly number[] = []): ApproverRequest {
  const request = requests(sampleGathering(setup, { purpose, holdingCode }, () => undefined))[place];

  if (request === undefined) throw new Error(`no request for place ${place}`);

  return request;
}

/** The proof a key's signature over the request's typed data becomes, through `replyFrom`. */
async function proofBy(request: ApproverRequest, signer: PrivateKeyAccount): Promise<Hex> {
  const input = orchestrator.signingInput(request);
  const signature = await signer.signTypedData(input as unknown as TypedDataDefinition);
  const reply = await orchestrator.replyFrom(request, input, { signature });

  if (isFailure(reply)) throw new Error(`reply refused: ${reply.cause}`);

  return reply.proof;
}

/** One bit of the signature's `r` flipped. */
const tampered = (proof: Hex): Hex => {
  const at = 10;
  const flipped = (parseInt(proof.charAt(at), 16) ^ 1).toString(16);

  return `${proof.slice(0, at)}${flipped}${proof.slice(at + 1)}` as Hex;
};

const request = requestAt(0, 'approval');
const proof = await proofBy(request, guardians[0] as PrivateKeyAccount);
const check = (proofBytes: Hex) => orchestrator.verify(request, request.place, proofBytes);

trace('orchestrator.describeRequest(request).device for place 0', orchestrator.describeRequest(request).device);
trace('the place-0 guardian signs; orchestrator.verify(request, place, proof)', await check(proof));
trace('the outsider signs the same typed data; orchestrator.verify(request, place, proof)', await check(await proofBy(request, outsider)));
trace('another guardian signs place 0; orchestrator.verify(request, place, proof)', await check(await proofBy(request, guardians[1] as PrivateKeyAccount)));
trace('tampered signature (one bit of r flipped)', tampered(proof));
trace('orchestrator.verify(request, place, tampered)', await check(tampered(proof)));

const input = orchestrator.signingInput(request);

trace("orchestrator.replyFrom(request, input, { signature: '0x' })", await orchestrator.replyFrom(request, input, { signature: '0x' }));
trace('orchestrator.replyFrom(request, input, undefined)', await orchestrator.replyFrom(request, input, undefined));

const holdsCode = requestAt(0, 'approval', [0]);
const codeProof = await proofBy(holdsCode, guardians[0] as PrivateKeyAccount);

trace('a request saying the place-0 address holds code: orchestrator.describeRequest(request).device', orchestrator.describeRequest(holdsCode).device);
trace('orchestrator.verify(request, place, proof) where the address holds code', await orchestrator.verify(holdsCode, 0, codeProof));

const cancel = requestAt(1, 'cancellation');
const cancelProof = await proofBy(cancel, guardians[1] as PrivateKeyAccount);

trace('a cancellation request, place 1: its purpose', cancel.purpose);
trace('orchestrator.verify(request, place, proof) for the cancellation', await orchestrator.verify(cancel, 1, cancelProof));
