import { SocialRecoveryBuilder, type IMethodsOrchestrator } from '@kohaku-eth/social-recovery';
import { anonAadhaarMethod, zkPassportMethod, type AnonAadhaarMethodOptions } from '@kohaku-eth/social-recovery/recovery-methods';
import { sampleDescriptor } from './sample';

/**
 * The methods orchestrator over the sample descriptor: the shipped wallet and passkey methods, the zkPassport method over the
 * installed `@zkpassport/sdk`, and the Aadhaar method over the given stack or artifacts (none: its stack is unavailable).
 * Every device binding is met, the builder's default.
 */
export const buildOrchestrator = (chainId: number, aadhaar: AnonAadhaarMethodOptions = {}): IMethodsOrchestrator =>
  SocialRecoveryBuilder.from({ chainId, descriptor: sampleDescriptor(chainId) })
    .withMethod(zkPassportMethod())
    .withMethod(anonAadhaarMethod(aadhaar))
    .buildMethodsOrchestrator();
