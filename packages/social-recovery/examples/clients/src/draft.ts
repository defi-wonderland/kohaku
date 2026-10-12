import type { SetupDraft } from '@kohaku-eth/social-recovery';
import { METHOD_ECDSA_CONFIG_FIELD } from '@kohaku-eth/social-recovery';
import { privateKeyToAccount } from 'viem/accounts';
import type { Session } from './session';

/**
 * The setup the sample commits: one clause of wallet guardians, `GUARDIAN_THRESHOLD` of them required, the env wait,
 * attempts a method's stop reaches, no public metadata and an encrypted backup the recovery restores by password.
 */
export function setupDraft(session: Session): SetupDraft {
  const { env, kit } = session;
  const credentials = env.guardianKeys.map((key, index) => ({
    method: kit.descriptor.methodEcdsa,
    config: kit.method.codec.encodeConfig({ [METHOD_ECDSA_CONFIG_FIELD]: privateKeyToAccount(key).address }),
    label: `guardian-${index + 1}`,
  }));

  return {
    wait: env.wait,
    clauses: [{ threshold: env.threshold, credentials }],
    ignoresPause: false,
    privacy: { publicMetadata: '0x', backup: 'encrypted' },
  };
}
