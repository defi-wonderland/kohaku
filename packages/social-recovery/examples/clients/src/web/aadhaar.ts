import type { Material, Params } from '@kohaku-eth/social-recovery';
import { anonAadhaarMethod } from '@kohaku-eth/social-recovery/recovery-methods';
import { note } from '../trace';
import { deviceStep } from './devices';
import { currentLifetime, ensureLive } from './lifetime';
import { field, statusLine, valueOf } from './page';

/** The seed field as a whole number; blank draws a fresh 31-byte seed into the field, which the approver keeps. */
function seed(): bigint {
  const text = valueOf('aadhaar-seed');

  if (text !== '') {
    if (!/^\d+$/.test(text)) throw new Error('the nullifier seed must be a whole number');

    return BigInt(text);
  }

  const drawn = BigInt(`0x${[...crypto.getRandomValues(new Uint8Array(31))].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`);

  field('aadhaar-seed').value = drawn.toString();
  note('drew a new nullifier seed; keep it, the approvals need the same one', drawn.toString());

  return drawn;
}

/** The pasted issuer certificate: UIDAI's production certificate in PEM. */
function certificate(): string {
  const text = field('aadhaar-certificate').value.trim();

  if (!text.includes('BEGIN CERTIFICATE')) throw new Error('paste UIDAI\'s production certificate (PEM) or load its file');

  return text;
}

/** The Aadhaar parameters both ceremonies take: the nullifier seed and the issuer certificate. */
export const aadhaarParams = (): Params => ({ nullifierSeed: seed(), issuerCertificate: certificate() });

/** Fills the seed field from the request's config, the seed the approvals must prove under. */
export function prefillAadhaarSeed(config: `0x${string}`): void {
  try {
    const decoded = anonAadhaarMethod().codec.decodeConfig(config);

    field('aadhaar-seed').value = String(decoded['nullifierSeed']);
  } catch {
    note('the request\'s config does not decode as an Aadhaar config');
  }
}

/**
 * The material a proving ceremony takes: the pasted QR code's data, the prover's progress written to the page and the
 * signal that ends once the Abort button ends the step or its action ends. The progress callback is bound to that step:
 * once it ended, a late progress update writes nothing. The proving files are downloaded by the stack on its first proof.
 */
export function aadhaarMaterial(): Material {
  const qrData = valueOf('aadhaar-qr');
  const progress = field('aadhaar-progress');

  if (qrData === '') throw new Error('paste the data of a real Aadhaar secure QR code');

  const { ended } = deviceStep();

  return {
    qrData,
    onProgress: (state: string) => {
      if (ended.aborted) return;

      progress.value = state;
      statusLine.textContent = `Aadhaar prover: ${state}`;
      note('Aadhaar prover', state);
    },
    signal: ended,
  };
}

/** Reads a certificate file chosen in the file field into the certificate text area, while its action still lives. */
export async function loadCertificateFile(): Promise<void> {
  const life = currentLifetime();
  const chosen = (field('aadhaar-certificate-file') as HTMLInputElement).files?.[0];

  if (chosen === undefined) throw new Error('choose the certificate file first');

  const text = await chosen.text();

  ensureLive(life);
  field('aadhaar-certificate').value = text;
  note('certificate loaded', chosen.name);
}
