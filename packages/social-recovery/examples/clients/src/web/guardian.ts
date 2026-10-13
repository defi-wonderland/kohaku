import {
  type ApproverRequest,
  type Hex,
  type Input,
  METHOD_ECDSA_CONFIG_FIELD,
  METHOD_ECDSA_PROOF_FIELD,
  type Reply,
  type TypedData,
  walletMethod,
} from '@kohaku-eth/social-recovery';
import { getTypesForEIP712Domain, isAddressEqual, serializeTypedData } from 'viem';
import { ctxFor, replyFor } from '../guardians';
import { note, step } from '../trace';
import { replyOut, statusLine, valueOf } from './page';
import { type Connection, settled } from './wallet';

const method = walletMethod();

/** The last reply the guardian panel built, for its Copy button. */
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

/**
 * Signs the pasted approver request with the connected account: ctxFor → signingInput → `eth_signTypedData_v4` →
 * replyFrom → replyFor, then shows the reply JSON and the local `verify` verdict. The session is checked after the
 * signature, after the proof and after the verdict, before anything is shown.
 */
export async function signRequest(conn: Connection): Promise<void> {
  const request = JSON.parse(valueOf('request-in')) as ApproverRequest;

  guardian.reply = undefined;
  replyOut.textContent = '';
  step(`guardian ${conn.account}: place ${request.place} of attempt ${request.attemptId}`);

  const ctx = ctxFor(request);
  const named = method.codec.decodeConfig(request.config)[METHOD_ECDSA_CONFIG_FIELD] as Hex;

  if (!isAddressEqual(named, conn.account)) note(`the request names guardian ${named}, not the connected ${conn.account}: verify will reject`);

  const input = method.signingInput(ctx);
  const signature = await settled(conn.session, conn.wallet.request({ method: 'eth_signTypedData_v4', params: [conn.account, v4Payload(input)] }) as Promise<Hex>);
  const proof = await settled(conn.session, method.replyFrom(ctx, input, { [METHOD_ECDSA_PROOF_FIELD]: signature }));

  if (typeof proof !== 'string') throw new Error(`the wallet method refused the signature: ${proof.cause}`);

  const verdict = await settled(conn.session, method.verify(ctx, proof));
  const reply = replyFor(ctx, proof);

  note('eth_signTypedData_v4', signature);
  note('method.verify (local verdict)', verdict);
  note('reply', reply);
  guardian.reply = reply;
  replyOut.textContent = `signed by ${conn.account}; local verdict: ${verdict}\n${JSON.stringify(reply, null, 2)}`;
  statusLine.textContent = `Reply for place ${request.place} built by ${conn.account}; copy it into the holder panel.`;
}
