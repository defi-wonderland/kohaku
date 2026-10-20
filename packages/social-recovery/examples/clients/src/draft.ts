import { type Credential, METHOD_ECDSA_ADDRESS_PARAM, type SetupDraft } from '@kohaku-eth/social-recovery';
import type { Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Kit } from './clients';
import type { Session } from './session';

/** A wallet guardian's credential: its config built through the orchestrator's `enrollInput` and `configFrom` for the wallet method. */
export async function walletCredential(kit: Kit, address: Address, label?: string): Promise<Credential> {
  const method = kit.descriptor.methodEcdsa;
  const input = kit.orchestrator.enrollInput(method, { [METHOD_ECDSA_ADDRESS_PARAM]: address });
  const config = await kit.orchestrator.configFrom(method, input, undefined);

  if (typeof config !== 'string') throw new Error(`the wallet method refused the guardian ${address}: ${config.cause}`);

  return { method, config, ...(label === undefined ? {} : { label }) };
}

/**
 * The setup the sample commits: one clause of wallet guardians, `GUARDIAN_THRESHOLD` of them required, the env wait,
 * attempts a method's stop reaches, no public metadata and an encrypted backup the recovery restores by password.
 */
export async function setupDraft(session: Session): Promise<SetupDraft> {
  const { env, kit } = session;
  const credentials = await Promise.all(
    env.guardianKeys.map((key, index) => walletCredential(kit, privateKeyToAccount(key).address, `guardian-${index + 1}`)),
  );

  return {
    wait: env.wait,
    clauses: [{ threshold: env.threshold, credentials }],
    ignoresPause: false,
    privacy: { publicMetadata: '0x', backup: 'encrypted' },
  };
}
