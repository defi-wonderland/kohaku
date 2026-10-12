import { requests, walletMethod, type ApproverRequest, type Ctx, type Hex } from '@kohaku-eth/social-recovery';
import type { TypedDataDefinition } from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { ctxFor } from './approver';
import { consoleTrace as trace, isFailure } from './format';
import { sampleGathering, sampleSetup } from './setup';

// The method's local check over a proof: satisfied, rejected or not judged, with no chain read.
const method = walletMethod();
const guardians = [0, 1, 2].map(() => privateKeyToAccount(generatePrivateKey()));
const outsider = privateKeyToAccount(generatePrivateKey());

trace('guardians (viem local accounts, keys generated for this run)', guardians.map((guardian) => guardian.address));
trace('an outsider, enrolled nowhere', outsider.address);

const setup = await sampleSetup(method, guardians.map((guardian) => guardian.address), trace);

/** The ctx for one place of a fresh gathering. */
function ctxAt(place: number, purpose: 'approval' | 'cancellation', holdingCode: readonly number[] = []): Ctx {
  const request: ApproverRequest | undefined = requests(sampleGathering(setup, { purpose, holdingCode }, () => undefined))[place];

  if (request === undefined) throw new Error(`no request for place ${place}`);

  return ctxFor(request);
}

/** The proof a key's signature over the ctx's typed data becomes. */
async function proofBy(ctx: Ctx, signer: PrivateKeyAccount): Promise<Hex> {
  const input = method.signingInput(ctx);
  const signature = await signer.signTypedData(input as unknown as TypedDataDefinition);
  const proof = await method.replyFrom(ctx, input, { signature });

  if (isFailure(proof)) throw new Error(`reply refused: ${proof.cause}`);

  return proof;
}

/** One bit of the signature's `r` flipped. */
const tampered = (proof: Hex): Hex => {
  const at = 10;
  const flipped = (parseInt(proof.charAt(at), 16) ^ 1).toString(16);

  return `${proof.slice(0, at)}${flipped}${proof.slice(at + 1)}` as Hex;
};

const ctx = ctxAt(0, 'approval');
const proof = await proofBy(ctx, guardians[0] as PrivateKeyAccount);

trace('method.describe(ctx) for place 0', method.describe(ctx));
trace('the place-0 guardian signs; method.verify(ctx, proof)', await method.verify(ctx, proof));

const outsiderProof = await proofBy(ctx, outsider);

trace('the outsider signs the same typed data; method.verify(ctx, proof)', await method.verify(ctx, outsiderProof));
trace('another guardian signs place 0; method.verify(ctx, proof)', await method.verify(ctx, await proofBy(ctx, guardians[1] as PrivateKeyAccount)));
trace('tampered signature (one bit of r flipped)', tampered(proof));
trace('method.verify(ctx, tampered)', await method.verify(ctx, tampered(proof)));

const input = method.signingInput(ctx);

trace("method.replyFrom(ctx, input, { signature: '0x' })", await method.replyFrom(ctx, input, { signature: '0x' }));
trace('method.replyFrom(ctx, input, undefined)', await method.replyFrom(ctx, input, undefined));

const holdsCode = ctxAt(0, 'approval', [0]);

trace('a request saying the place-0 address holds code: method.describe(ctx)', method.describe(holdsCode));
trace('method.verify(ctx, proof) where the address holds code', await method.verify(holdsCode, await proofBy(holdsCode, guardians[0] as PrivateKeyAccount)));

const cancel = ctxAt(1, 'cancellation');

trace('a cancellation request, place 1: ctx.typedData.primaryType', cancel.typedData.primaryType);
trace('method.verify(ctx, proof) for the cancellation', await method.verify(cancel, await proofBy(cancel, guardians[1] as PrivateKeyAccount)));
