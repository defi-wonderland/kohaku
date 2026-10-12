import { fileReply, requests, walletMethod, type Address, type Ctx, type Gathering, type Hex, type TypedData } from '@kohaku-eth/social-recovery';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { getAddress, getTypesForEIP712Domain, hexToNumber, serializeTypedData } from 'viem';
import { ctxFor, replyFor } from '../approver';
import { isFailure, show, type Trace } from '../format';
import { sampleGathering, sampleSetup } from '../setup';

/** The EIP-1193 surface the page calls on the injected wallet. */
type InjectedWallet = {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
};

const element = <T extends HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);

  if (found === null) throw new Error(`missing element ${selector}`);

  return found;
};

const connectButton = element<HTMLButtonElement>('#connect');
const signButton = element<HTMLButtonElement>('#sign');
const verdictLine = element<HTMLParagraphElement>('#verdict');
const traceBox = element<HTMLDivElement>('#trace');

/** A trace that appends each SDK call and its result to the page. */
const pageTrace: Trace = (step, value) => {
  const heading = document.createElement('h3');

  heading.textContent = step;
  traceBox.append(heading);

  if (value === undefined) return;

  const body = document.createElement('pre');

  body.textContent = show(value);
  traceBox.append(body);
};

const method = walletMethod();
const state: { wallet?: InjectedWallet; guardian?: Address; ctx?: Ctx; record?: Gathering } = {};

const injectedWallet = (): InjectedWallet | undefined =>
  (window as unknown as { ethereum?: InjectedWallet }).ethereum;

/** The typed data as `eth_signTypedData_v4` takes it: the domain's own type added, then serialized to JSON. */
const v4Payload = (typedData: TypedData): string =>
  serializeTypedData({
    domain: typedData.domain,
    types: { EIP712Domain: getTypesForEIP712Domain({ domain: typedData.domain }), ...typedData.types },
    primaryType: typedData.primaryType,
    message: typedData.message,
  } as unknown as Parameters<typeof serializeTypedData>[0]);

/** Connects, enrols the wallet at place 0 of a sample setup beside two generated guardians, and builds its ctx. */
async function connect(): Promise<void> {
  const wallet = injectedWallet();

  if (wallet === undefined) throw new Error('no injected wallet: install or enable a browser wallet and reload');

  const accounts = (await wallet.request({ method: 'eth_requestAccounts' })) as readonly string[];
  const first = accounts[0];

  if (first === undefined) throw new Error('the wallet returned no account');

  const guardian = getAddress(first);
  const chainId = hexToNumber((await wallet.request({ method: 'eth_chainId' })) as Hex);

  traceBox.replaceChildren();
  pageTrace('connected guardian (eth_requestAccounts)', guardian);
  pageTrace("the wallet's chain id (eth_chainId), used as the request's domain chain id", chainId);

  const others = [0, 1].map(() => privateKeyToAddress(generatePrivateKey()));
  const setup = await sampleSetup(method, [guardian, ...others], pageTrace);
  const record = sampleGathering(setup, { purpose: 'approval', chainId }, pageTrace);
  const request = requests(record)[0];

  if (request === undefined) throw new Error('the record has no place 0');

  pageTrace('requests(record)[0]: the approver request for your place', request);

  const ctx = ctxFor(request);

  pageTrace('ctxFor(request).digest', ctx.digest);
  Object.assign(state, { wallet, guardian, ctx, record });
  signButton.disabled = false;
}

/** Signs through the wallet, builds the proof and the reply, files it and verifies it locally. */
async function sign(): Promise<void> {
  const { wallet, guardian, ctx, record } = state;

  if (wallet === undefined || guardian === undefined || ctx === undefined || record === undefined) throw new Error('connect first');

  const input = method.signingInput(ctx);

  pageTrace('method.signingInput(ctx): the typed data your wallet shows', input);

  const signature = (await wallet.request({ method: 'eth_signTypedData_v4', params: [guardian, v4Payload(ctx.typedData)] })) as Hex;

  pageTrace('eth_signTypedData_v4', signature);

  const proof = await method.replyFrom(ctx, input, { signature });

  pageTrace('method.replyFrom(ctx, input, { signature })', proof);

  if (isFailure(proof)) throw new Error(`reply refused: ${proof.cause}`);

  const reply = replyFor(ctx, proof);

  pageTrace('replyFor(ctx, proof): the reply', reply);

  pageTrace('fileReply(record, reply).outcome', fileReply(record, reply).outcome);

  const verdict = await method.verify(ctx, proof);

  pageTrace('method.verify(ctx, proof)', verdict);
  verdictLine.textContent = `Verdict: ${verdict}`;
}

/** Runs a step, showing a failure on the page instead of losing it in the console. */
const guarded = (step: () => Promise<void>) => async (): Promise<void> => {
  verdictLine.textContent = '';

  try {
    await step();
  } catch (error) {
    verdictLine.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
};

connectButton.addEventListener('click', guarded(connect));
signButton.addEventListener('click', guarded(sign));
