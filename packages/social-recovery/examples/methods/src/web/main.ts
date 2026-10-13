import { fileReply, requests, walletMethod, type Address, type Ctx, type Gathering, type Hex, type Input, type TypedData } from '@kohaku-eth/social-recovery';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { getAddress, getTypesForEIP712Domain, hexToNumber, serializeTypedData } from 'viem';
import { ctxFor, replyFor } from '../approver';
import { isFailure, show, type Trace } from '../format';
import { sampleGathering, sampleSetup } from '../setup';

/** The EIP-1193 surface the page calls on the injected wallet. */
type InjectedWallet = {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(event: string, listener: (payload: unknown) => void): void;
};

const element = <T extends HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);

  if (found === null) throw new Error(`missing element ${selector}`);

  return found;
};

const connectButton = element<HTMLButtonElement>('#connect');
const signButton = element<HTMLButtonElement>('#sign');
const connectionLine = element<HTMLParagraphElement>('#connection');
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

/** The cached connection; `session` grows on every reset, so a step that awaited across one drops its result. */
const state: {
  session: number; busy: boolean; listening: boolean;
  wallet?: InjectedWallet; guardian?: Address; chainId?: number; ctx?: Ctx; record?: Gathering;
} = { session: 0, busy: false, listening: false };

const injectedWallet = (): InjectedWallet | undefined =>
  (window as unknown as { ethereum?: InjectedWallet }).ethereum;

/** The typed data as `eth_signTypedData_v4` takes it: the domain's own type added, then serialized to JSON. */
const v4Payload = (input: Input): string => {
  const typedData = input as unknown as TypedData;

  return serializeTypedData({
    domain: typedData.domain,
    types: { EIP712Domain: getTypesForEIP712Domain({ domain: typedData.domain }), ...typedData.types },
    primaryType: typedData.primaryType,
    message: typedData.message,
  } as unknown as Parameters<typeof serializeTypedData>[0]);
};

/** Drops the cached connection, request and verdict; Connect must run again. */
function reset(reason?: string): void {
  Object.assign(state, { session: state.session + 1, guardian: undefined, chainId: undefined, ctx: undefined, record: undefined });
  signButton.disabled = true;
  connectionLine.textContent = '';
  verdictLine.textContent = reason === undefined ? '' : `${reason}: connect again`;
  traceBox.replaceChildren();
}

/** Resets when the wallet reports an account or chain other than the cached one. */
function listen(wallet: InjectedWallet): void {
  if (state.listening || wallet.on === undefined) return;

  state.listening = true;
  wallet.on('accountsChanged', (accounts) => {
    const next = Array.isArray(accounts) && typeof accounts[0] === 'string' ? getAddress(accounts[0]) : undefined;

    if (state.guardian !== undefined && next !== state.guardian) reset('the wallet switched account');
  });
  wallet.on('chainChanged', (chain) => {
    if (state.chainId !== undefined && hexToNumber(chain as Hex) !== state.chainId) reset('the wallet switched chain');
  });
}

/** Throws when a reset happened since `session` was read. */
const ensureSession = (session: number): void => {
  if (session !== state.session) throw new Error('the wallet changed while this step ran; connect again');
};

/** Connects, reads whether the address holds code, enrols it at place 0 of a sample setup beside two generated guardians, and builds its ctx. */
async function connect(): Promise<void> {
  const wallet = injectedWallet();

  if (wallet === undefined) throw new Error('no injected wallet: install or enable a browser wallet and reload');

  reset();
  listen(wallet);

  const session = state.session;
  const accounts = (await wallet.request({ method: 'eth_requestAccounts' })) as readonly string[];
  const first = accounts[0];

  if (first === undefined) throw new Error('the wallet returned no account');

  const guardian = getAddress(first);
  const chainId = hexToNumber((await wallet.request({ method: 'eth_chainId' })) as Hex);

  ensureSession(session);
  Object.assign(state, { guardian, chainId });
  pageTrace('connected guardian (eth_requestAccounts)', guardian);
  pageTrace("the wallet's chain id (eth_chainId), used as the request's domain chain id", chainId);

  const code = (await wallet.request({ method: 'eth_getCode', params: [guardian, 'latest'] })) as Hex | null;
  const holdsCode = typeof code === 'string' && code !== '0x' && code !== '0x0';

  ensureSession(session);
  pageTrace("eth_getCode(guardian, 'latest'): credentialHoldsCode", holdsCode);

  const others = [0, 1].map(() => privateKeyToAddress(generatePrivateKey()));
  const setup = await sampleSetup(method, [guardian, ...others], pageTrace);
  const record = sampleGathering(setup, { purpose: 'approval', chainId, holdingCode: holdsCode ? [0] : [] }, pageTrace);
  const request = requests(record)[0];

  if (request === undefined) throw new Error('the record has no place 0');

  pageTrace('requests(record)[0]: the approver request for your place', request);

  const ctx = ctxFor(request);

  pageTrace('ctxFor(request).digest', ctx.digest);
  ensureSession(session);
  Object.assign(state, { wallet, ctx, record });
  connectionLine.textContent = `Connected ${guardian} on chain ${chainId}; credentialHoldsCode: ${holdsCode}`;
}

/** Signs through the wallet, builds the proof and the reply, files it and verifies it locally. */
async function sign(): Promise<void> {
  const { session, wallet, guardian, ctx, record } = state;

  if (wallet === undefined || guardian === undefined || ctx === undefined || record === undefined) throw new Error('connect first');

  const input = method.signingInput(ctx);

  pageTrace('method.signingInput(ctx): the typed data your wallet shows', input);

  const signature = (await wallet.request({ method: 'eth_signTypedData_v4', params: [guardian, v4Payload(input)] })) as Hex;

  ensureSession(session);
  pageTrace('eth_signTypedData_v4', signature);

  const proof = await method.replyFrom(ctx, input, { signature });

  pageTrace('method.replyFrom(ctx, input, { signature })', proof);

  if (isFailure(proof)) throw new Error(`reply refused: ${proof.cause}`);

  const reply = replyFor(ctx, proof);

  pageTrace('replyFor(ctx, proof): the reply', reply);
  pageTrace('fileReply(record, reply).outcome', fileReply(record, reply).outcome);

  const verdict = await method.verify(ctx, proof);

  ensureSession(session);
  pageTrace('method.verify(ctx, proof)', verdict);
  verdictLine.textContent = `Verdict: ${verdict}`;
}

/** Runs one step at a time, both buttons off while it runs, showing a failure on the page instead of losing it in the console. */
const guarded = (step: () => Promise<void>) => async (): Promise<void> => {
  if (state.busy) return;

  state.busy = true;
  connectButton.disabled = true;
  signButton.disabled = true;
  verdictLine.textContent = '';

  try {
    await step();
  } catch (error) {
    verdictLine.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    state.busy = false;
    connectButton.disabled = false;
    signButton.disabled = state.ctx === undefined;
  }
};

connectButton.addEventListener('click', guarded(connect));
signButton.addEventListener('click', guarded(sign));
