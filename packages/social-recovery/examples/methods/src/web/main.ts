import { fileReply, requests, walletMethod, type Hex, type Input, type TypedData } from '@kohaku-eth/social-recovery';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { getTypesForEIP712Domain, serializeTypedData } from 'viem';
import { ctxFor, replyFor } from '../approver';
import { isFailure } from '../format';
import { sampleGathering, sampleSetup } from '../setup';
import { connectButton, connectionLine, pageTrace, signButton, verdictLine } from './page';
import { ensureSession, injectedWallet, listen, requestConnection, reset, state } from './session';

const method = walletMethod();

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

/** Connects, reads whether the address holds code, enrols it at place 0 of a sample setup beside two generated guardians, and builds its ctx. */
async function connect(): Promise<void> {
  const wallet = injectedWallet();

  if (wallet === undefined) throw new Error('no injected wallet: install or enable a browser wallet and reload');

  reset();
  listen(wallet);

  const session = state.session;
  const { guardian, chainId } = await requestConnection(wallet, session);

  pageTrace('connected guardian (eth_requestAccounts, re-read with eth_accounts)', guardian);
  pageTrace("the wallet's chain id (eth_chainId, read twice), used as the request's domain chain id", chainId);

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

/** Signs through the wallet, builds the proof and the reply, files it and verifies it locally; the session is checked after the signature, after the proof and after the verdict. */
async function sign(): Promise<void> {
  const { session, wallet, guardian, ctx, record } = state;

  if (wallet === undefined || guardian === undefined || ctx === undefined || record === undefined) throw new Error('connect first');

  const input = method.signingInput(ctx);

  pageTrace('method.signingInput(ctx): the typed data your wallet shows', input);

  const signature = (await wallet.request({ method: 'eth_signTypedData_v4', params: [guardian, v4Payload(input)] })) as Hex;

  ensureSession(session);
  pageTrace('eth_signTypedData_v4', signature);

  const proof = await method.replyFrom(ctx, input, { signature });

  ensureSession(session);
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
