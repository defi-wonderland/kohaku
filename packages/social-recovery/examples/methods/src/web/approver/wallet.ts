import type { Hex, Input, TypedData } from '@kohaku-eth/social-recovery';
import { getTypesForEIP712Domain, serializeTypedData, type TypedDataDefinition } from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { pageTrace } from '../page';
import { ensureSession, state } from '../session';
import { testOnly } from '../shared/test-storage';
import type { ApproverMethod } from './types';

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

/** The page's TEST-ONLY wallet: a viem key generated once in this browser and kept in `localStorage`. */
export const testWallet = (): PrivateKeyAccount => privateKeyToAccount(testOnly('wallet key', generatePrivateKey) as Hex);

/** The connected wallet's session, or a thrown error asking to connect. */
const connected = () => {
  const { session, wallet, guardian, chainId } = state;

  if (wallet === undefined || guardian === undefined || chainId === undefined) {
    throw new Error('real mode: connect your wallet first, or turn testing mode on');
  }

  return { session, wallet, guardian, chainId };
};

/** The wallet method: a local TEST-ONLY key in testing mode, the injected wallet through `eth_signTypedData_v4` in real mode. */
export const walletPage: ApproverMethod = {
  testingLabel: 'Testing mode: a viem key generated in this page and kept in localStorage (TEST ONLY), signing with signTypedData',
  realLabel: 'Real mode: your injected wallet, connected below, signing with eth_signTypedData_v4',

  async enrolParams(run) {
    if (run.testing) {
      const address = testWallet().address;

      pageTrace("the page's TEST-ONLY wallet address", address);

      return { address };
    }

    return { address: connected().guardian };
  },

  async enrolMaterial(_input, run) {
    if (run.testing) return { material: undefined };

    const { session } = connected();

    return { material: undefined, checkpoint: () => ensureSession(session) };
  },

  async signParams() {
    return undefined;
  },

  async signMaterial(request, input, run) {
    if (run.testing) {
      const signature = await testWallet().signTypedData(input as unknown as TypedDataDefinition);

      pageTrace("the TEST-ONLY wallet's signTypedData(input)", signature);

      return { material: { signature } };
    }

    const { session, wallet, guardian, chainId } = connected();

    if (Number(request.chainId) !== chainId) {
      throw new Error(
        `the request carries chain ${request.chainId} but your wallet is on chain ${chainId}: wallets refuse typed data for another chain, so ask the holder for requests on chain ${chainId} or switch the wallet and connect again`,
      );
    }

    const signature = (await wallet.request({ method: 'eth_signTypedData_v4', params: [guardian, v4Payload(input)] })) as Hex;

    ensureSession(session);
    pageTrace('eth_signTypedData_v4', signature);

    return { material: { signature }, checkpoint: () => ensureSession(session) };
  },
};
