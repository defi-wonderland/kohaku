import {
  type ApproverRequest,
  type Hex,
  type IMethodsOrchestrator,
  type Input,
  METHOD_ECDSA_PROOF_FIELD,
  METHOD_PASSKEY_ASSERTION_MATERIAL,
  type Reply,
  type ReplyFailure,
  type TypedData,
} from '@kohaku-eth/social-recovery';
import { getTypesForEIP712Domain, isAddressEqual, serializeTypedData } from 'viem';
import { namedGuardian } from '../guardians';
import { note, step } from '../trace';
import { aadhaarMaterial, aadhaarParams } from './aadhaar';
import type { MethodKind } from './approver-deployment';
import { describeRequest } from './describe-request';
import { passkeyAssertion, zkPassportAnswer } from './devices';
import { ensureLive } from './lifetime';
import { replyOut, statusLine, valueOf } from './page';
import { zkPassportParams } from './zkpassport';
import { connected, ensureSession } from './wallet';

/** The last reply the approver page built, for its Copy button. */
export const guardian: { reply?: Reply } = {};

/** The typed data as `eth_signTypedData_v4` takes it: the domain's own type added, then serialized to JSON. */
export const v4Payload = (input: Input): string => {
  const typedData = input as unknown as TypedData;

  return serializeTypedData({
    domain: typedData.domain,
    types: { EIP712Domain: getTypesForEIP712Domain({ domain: typedData.domain }), ...typedData.types },
    primaryType: typedData.primaryType,
    message: typedData.message,
  } as unknown as Parameters<typeof serializeTypedData>[0]);
};

/** One method's answer: the reply or the orchestrator's typed failure, who gave it, and the check run after each later step. */
type Answered = { readonly reply: Reply | ReplyFailure; readonly by: string; readonly settle: () => void };

type Signer = (orchestrator: IMethodsOrchestrator, request: ApproverRequest) => Promise<Answered>;

/**
 * The wallet: the connected account signs the typed data (`eth_signTypedData_v4`); the session is checked after the
 * signature and after the proof. A request naming another guardian is signed anyway and noted: verify will reject it.
 */
const walletSigner: Signer = async (orchestrator, request) => {
  const conn = connected();
  const named = namedGuardian(orchestrator, request);

  if (named !== undefined && !isAddressEqual(named, conn.account)) {
    note(`the request names guardian ${named}, not the connected ${conn.account}: verify will reject`);
  }

  const input = orchestrator.signingInput(request);
  const signature = (await conn.wallet.request({ method: 'eth_signTypedData_v4', params: [conn.account, v4Payload(input)] })) as Hex;

  ensureSession(conn.session);
  note('eth_signTypedData_v4', signature);

  const reply = await orchestrator.replyFrom(request, input, { [METHOD_ECDSA_PROOF_FIELD]: signature });

  ensureSession(conn.session);

  return { reply, by: conn.account, settle: () => ensureSession(conn.session) };
};

/** The passkey: `navigator.credentials.get` under this page's host as the relying-party id, the digest as the challenge. */
const passkeySigner: Signer = async (orchestrator, request) => {
  const credentialId = valueOf('passkey-credential-id');
  const params = { relyingPartyId: location.hostname, ...(credentialId === '' ? {} : { credentialId }) };
  const input = orchestrator.signingInput(request, params);
  const assertion = await passkeyAssertion(input);
  const reply = await orchestrator.replyFrom(request, input, { [METHOD_PASSKEY_ASSERTION_MATERIAL]: assertion });

  ensureLive();

  return { reply, by: `the passkey for ${location.hostname}`, settle: ensureLive };
};

/** zkPassport: the request opened on the installed SDK, the phone app proves over a real document, the proofs come back. */
const zkPassportSigner: Signer = async (orchestrator, request) => {
  const input = orchestrator.signingInput(request, zkPassportParams());
  const answer = await zkPassportAnswer(input, document.querySelector<HTMLAnchorElement>('#zk-link') ?? document.createElement('a'));
  const reply = await orchestrator.replyFrom(request, input, { proofs: answer.proofs });

  ensureLive();

  return { reply, by: 'the zkPassport app', settle: ensureLive };
};

/** Aadhaar: the in-browser prover over a real QR code and the production certificate, the digest as the signal. */
const aadhaarSigner: Signer = async (orchestrator, request) => {
  const input = orchestrator.signingInput(request, aadhaarParams());
  const reply = await orchestrator.replyFrom(request, input, aadhaarMaterial());

  ensureLive();

  return { reply, by: 'the Aadhaar prover in this browser', settle: ensureLive };
};

const SIGNERS: Readonly<Record<MethodKind, Signer>> = {
  wallet: walletSigner,
  passkey: passkeySigner,
  zkpassport: zkPassportSigner,
  aadhaar: aadhaarSigner,
};

/**
 * Answers the pasted request with real material for its method: describeRequest → signingInput → the device →
 * replyFrom, then shows the reply line and the local `verify` verdict. Nothing is shown when the session or the
 * action ended after the material, the proof or the verdict. A module no implementation serves is the orchestrator's
 * own refusal.
 */
export async function signRequest(): Promise<void> {
  guardian.reply = undefined;
  replyOut.textContent = '';

  const { request, orchestrator, kind } = describeRequest();

  step(`signingInput → material → replyFrom (${kind}) for place ${request.place} of attempt ${request.attemptId}`);

  const { reply, by, settle } = await SIGNERS[kind](orchestrator, request);

  if (reply.kind === 'reply-failure') throw new Error(`replyFrom refused the material: ${reply.cause}`);

  const verdict = await orchestrator.verify(request, request.place, reply.proof);

  settle();
  note('verify (local verdict)', verdict);
  note('reply', reply);
  guardian.reply = reply;
  replyOut.textContent = `answered by ${by}; local verdict: ${verdict}\n${JSON.stringify(reply)}`;
  statusLine.textContent = `Reply for place ${request.place} built by ${by}; copy it into the holder page.`;
}
