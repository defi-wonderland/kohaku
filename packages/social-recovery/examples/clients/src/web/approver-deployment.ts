import {
  type Address,
  DEVICE_BINDINGS,
  type DeploymentDescriptor,
  DIGEST_VERSION,
  type IMethodsOrchestrator,
  SocialRecoveryBuilder,
} from '@kohaku-eth/social-recovery';
import { type AnonAadhaarArtifacts, anonAadhaarMethod, zkPassportMethod } from '@kohaku-eth/social-recovery/recovery-methods';
import { isAddressEqual, zeroAddress } from 'viem';
import { note, step } from '../trace';
import { addressField, wholeField } from './config';
import { SEPOLIA_CHAIN_ID } from './chain';
import { valueOf } from './page';

/** The four methods a deployment names, as the approver page tells them apart. */
export type MethodKind = 'wallet' | 'passkey' | 'zkpassport' | 'aadhaar';

/** Where anon-aadhaar publishes its v2 proving files, as `@anon-aadhaar/core` 2.4.3's `artifactUrls.v2` names them. */
const AADHAAR_V2 = 'https://anon-aadhaar-artifacts.s3.eu-central-1.amazonaws.com/v2.0.0';

/**
 * The Aadhaar proving files the stack downloads when it first proves: the whole zkey from the server, or the zkey in
 * chunks, the fallback for a connection that cannot take the one large file.
 */
export function aadhaarArtifacts(origin: 'server' | 'chunked'): AnonAadhaarArtifacts {
  return {
    wasmURL: `${AADHAAR_V2}/aadhaar-verifier.wasm`,
    zkeyURL: origin === 'server' ? `${AADHAAR_V2}/circuit_final.zkey` : `${AADHAAR_V2}/chunked_zkey`,
    vkeyURL: `${AADHAAR_V2}/vkey.json`,
    artifactsOrigin: origin,
  };
}

/** The chosen origin of the Aadhaar proving files. */
export const aadhaarOrigin = (): 'server' | 'chunked' => (valueOf('aadhaar-origin') === 'chunked' ? 'chunked' : 'server');

/**
 * The descriptor from the approver page's reduced Deployment block, built without any read: Sepolia's chain id, the
 * SDK's digest version, the typed manager version (empty where none is typed), the wallet and passkey methods as the
 * shipped ones and the action as the audited one, as the holder page states them.
 */
export function approverDescriptor(): DeploymentDescriptor {
  const methodEcdsa = addressField('method-ecdsa');
  const methodPasskey = addressField('method-passkey');
  const action = addressField('action');

  return {
    chainId: SEPOLIA_CHAIN_ID,
    manager: addressField('manager'),
    methodEcdsa,
    methodPasskey,
    methodAadhaar: addressField('method-aadhaar', zeroAddress),
    methodZkpassport: addressField('method-zkpassport', zeroAddress),
    action,
    servedImplementation: addressField('implementation'),
    deployedAt: wholeField('deploy-block'),
    digestVersion: DIGEST_VERSION,
    managerVersion: valueOf('manager-version'),
    shippedMethods: [methodEcdsa, methodPasskey],
    auditedActions: [action],
  };
}

/** The orchestrator built last and what it was built from, so an unchanged form builds it once. */
let built: { key: string; orchestrator: IMethodsOrchestrator } | undefined;

/**
 * The methods orchestrator over the form's descriptor, every device binding met, the zkPassport and Aadhaar methods
 * added beside the shipped wallet and passkey methods; it holds no provider and reads no chain.
 */
export function approverOrchestrator(): { descriptor: DeploymentDescriptor; orchestrator: IMethodsOrchestrator } {
  const descriptor = approverDescriptor();
  const origin = aadhaarOrigin();
  const key = `${JSON.stringify(descriptor)}|${origin}`;

  if (built?.key !== key) {
    step('buildMethodsOrchestrator (descriptor from the form, no chain read)');
    note('descriptor', descriptor);
    note('Aadhaar proving files', origin);
    built = {
      key,
      orchestrator: SocialRecoveryBuilder.from({ descriptor, deviceBindings: DEVICE_BINDINGS })
        .withMethod(zkPassportMethod())
        .withMethod(anonAadhaarMethod({ artifacts: aadhaarArtifacts(origin) }))
        .buildMethodsOrchestrator(),
    };
  }

  return { descriptor, orchestrator: built.orchestrator };
}

/** Which of the descriptor's four methods a module is; `undefined` for a module the deployment does not name. */
export function methodKind(descriptor: DeploymentDescriptor, module: Address): MethodKind | undefined {
  const named: readonly [MethodKind, Address][] = [
    ['wallet', descriptor.methodEcdsa],
    ['passkey', descriptor.methodPasskey],
    ['zkpassport', descriptor.methodZkpassport],
    ['aadhaar', descriptor.methodAadhaar],
  ];
  const found = named.find(([, address]) => !isAddressEqual(address, zeroAddress) && isAddressEqual(address, module));

  return found?.[0];
}

/** The module of one method kind under the descriptor; a method the deployment carries as the zero address throws. */
export function moduleOf(descriptor: DeploymentDescriptor, kind: MethodKind): Address {
  const module = {
    wallet: descriptor.methodEcdsa,
    passkey: descriptor.methodPasskey,
    zkpassport: descriptor.methodZkpassport,
    aadhaar: descriptor.methodAadhaar,
  }[kind];

  if (isAddressEqual(module, zeroAddress)) throw new Error(`the deployment form names no ${kind} method`);

  return module;
}
