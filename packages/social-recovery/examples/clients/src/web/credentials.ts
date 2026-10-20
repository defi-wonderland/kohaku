import type { Credential } from '@kohaku-eth/social-recovery';
import { getAddress, isAddress, isHex } from 'viem';
import type { Kit } from '../clients';
import { walletCredential } from '../draft';
import { note } from '../trace';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** One pasted credential line read as the SDK's `Credential` record; a malformed line throws naming its number. */
function credentialRecord(text: string, number: number): Credential {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`credential line ${number} is neither an address nor JSON`);
  }

  if (!isRecord(parsed)) throw new Error(`credential line ${number} is not a { method, config } record`);

  const { method, config, label, salt } = parsed;

  if (typeof method !== 'string' || !isAddress(method, { strict: false })) throw new Error(`credential line ${number}: method must be an address`);

  if (typeof config !== 'string' || !isHex(config)) throw new Error(`credential line ${number}: config must be 0x-prefixed hex`);

  if (label !== undefined && typeof label !== 'string') throw new Error(`credential line ${number}: label must be a string`);

  if (salt !== undefined && (typeof salt !== 'string' || !isHex(salt))) throw new Error(`credential line ${number}: salt must be 0x-prefixed hex`);

  return { method: getAddress(method), config, ...(label === undefined ? {} : { label }), ...(salt === undefined ? {} : { salt }) };
}

/**
 * The guardians' credentials typed in the setup form, one line per guardian in any mix of methods: a `Credential`
 * record as JSON (the approver page's credential line), or a bare address, a wallet credential whose config the
 * orchestrator builds for the deployment's wallet method. A line of comma-separated addresses names one guardian each.
 * Each credential without a label is labelled by its position.
 */
export async function setupCredentials(kit: Kit, text: string): Promise<readonly Credential[]> {
  const entries = text.split('\n').map((entry) => entry.trim()).filter((entry) => entry !== '')
    .flatMap((entry) => (entry.startsWith('{') ? [entry] : entry.split(',').map((part) => part.trim()).filter((part) => part !== '')));

  if (entries.length === 0) throw new Error('name at least one guardian: a credential line or an address');

  const credentials = await Promise.all(entries.map(async (entry, index) => {
    const label = `guardian-${index + 1}`;

    if (isAddress(entry, { strict: false })) return walletCredential(kit, getAddress(entry), label);

    const record = credentialRecord(entry, index + 1);

    return record.label === undefined ? { ...record, label } : record;
  }));

  for (const credential of credentials) note(`credential ${credential.label ?? ''}`, { method: credential.method, config: credential.config });

  return credentials;
}
