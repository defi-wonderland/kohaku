import type { Credential } from '@kohaku-eth/social-recovery';
import { type Address, getAddress, isAddress, isAddressEqual, isHex, zeroAddress } from 'viem';
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

/** The four method modules the applied deployment names, the zero address (a method it does not carry) left out. */
function deploymentModules(kit: Kit): readonly [string, Address][] {
  const { methodEcdsa, methodPasskey, methodZkpassport, methodAadhaar } = kit.descriptor;
  const named: readonly [string, Address][] = [
    ['wallet', methodEcdsa],
    ['passkey', methodPasskey],
    ['zkPassport', methodZkpassport],
    ['Aadhaar', methodAadhaar],
  ];

  return named.filter(([, module]) => !isAddressEqual(module, zeroAddress));
}

/** Refuses a credential whose module is not one of the applied deployment's four method modules, naming its line. */
function ensureDeploymentModule(kit: Kit, credential: Credential, number: number): void {
  const modules = deploymentModules(kit);

  if (modules.some(([, module]) => isAddressEqual(module, credential.method))) return;

  const known = modules.map(([name, module]) => `${name} ${module}`).join(', ');

  throw new Error(`credential line ${number} names the module ${credential.method}, not one of the deployment's methods (${known})`);
}

/** The form's guardian entries with the line each sits on: a JSON line whole, any other line split on whitespace or commas. */
function guardianEntries(text: string): readonly { readonly entry: string; readonly number: number }[] {
  return text.split('\n').flatMap((raw, index) => {
    const entry = raw.trim();
    const number = index + 1;

    if (entry === '') return [];

    if (entry.startsWith('{')) return [{ entry, number }];

    return entry.split(/[\s,]+/).filter((part) => part !== '').map((part) => ({ entry: part, number }));
  });
}

/**
 * The guardians' credentials typed in the setup form, one line per guardian in any mix of methods: a `Credential`
 * record as JSON (the approver page's credential line), or a bare address, a wallet credential whose config the
 * orchestrator builds for the deployment's wallet method. A line of addresses separated by whitespace or commas names
 * one guardian each. A credential whose module is not one of the applied deployment's four methods is refused, naming
 * its line. Each credential without a label is labelled by its position.
 */
export async function setupCredentials(kit: Kit, text: string): Promise<readonly Credential[]> {
  const entries = guardianEntries(text);

  if (entries.length === 0) throw new Error('name at least one guardian: a credential line or an address');

  const credentials = await Promise.all(entries.map(async ({ entry, number }, index) => {
    const label = `guardian-${index + 1}`;

    const record = isAddress(entry, { strict: false })
      ? await walletCredential(kit, getAddress(entry), label)
      : credentialRecord(entry, number);

    ensureDeploymentModule(kit, record, number);

    return record.label === undefined ? { ...record, label } : record;
  }));

  for (const credential of credentials) note(`credential ${credential.label ?? ''}`, { method: credential.method, config: credential.config });

  return credentials;
}
