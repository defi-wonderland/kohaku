import { DIGEST_VERSION, type Address, type DeploymentDescriptor } from '@kohaku-eth/social-recovery';
import { getAddress, keccak256, slice, toHex } from 'viem';
import { SAMPLE_LABELS, SAMPLE_MANAGER_VERSION } from './constants';

/** A local address derived from a label, so the sample needs no deployment. */
export const localAddress = (label: string): Address => getAddress(slice(keccak256(toHex(label)), 12));

/** The sample's fixed addresses: the account, the manager, the action and one module per method. */
export const SAMPLE = {
  account: localAddress(SAMPLE_LABELS.account),
  manager: localAddress(SAMPLE_LABELS.manager),
  action: localAddress(SAMPLE_LABELS.action),
  servedImplementation: localAddress(SAMPLE_LABELS.servedImplementation),
  methods: {
    wallet: localAddress(SAMPLE_LABELS.method),
    passkey: localAddress(SAMPLE_LABELS.methodPasskey),
    zkpassport: localAddress(SAMPLE_LABELS.methodZkpassport),
    aadhaar: localAddress(SAMPLE_LABELS.methodAadhaar),
  },
} as const;

/** The methods the playground serves, by the name its pages use. */
export type SampleMethod = keyof typeof SAMPLE.methods;

/** The method name a module address belongs to, or `undefined` for a module the sample does not hold. */
export const sampleMethodOf = (module: string): SampleMethod | undefined =>
  (Object.keys(SAMPLE.methods) as SampleMethod[]).find((name) => SAMPLE.methods[name].toLowerCase() === module.toLowerCase());

/** A descriptor over the sample's local addresses, so the builder keys every method's module with no deployment. */
export const sampleDescriptor = (chainId: number): DeploymentDescriptor => ({
  chainId,
  manager: SAMPLE.manager,
  methodEcdsa: SAMPLE.methods.wallet,
  methodPasskey: SAMPLE.methods.passkey,
  methodAadhaar: SAMPLE.methods.aadhaar,
  methodZkpassport: SAMPLE.methods.zkpassport,
  action: SAMPLE.action,
  servedImplementation: SAMPLE.servedImplementation,
  deployedAt: 0,
  digestVersion: DIGEST_VERSION,
  managerVersion: SAMPLE_MANAGER_VERSION,
  shippedMethods: Object.values(SAMPLE.methods),
  auditedActions: [SAMPLE.action],
});
