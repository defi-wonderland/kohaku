import type { Params } from '@kohaku-eth/social-recovery';
import { pageTrace } from '../page';
import { testCertificate, type ArtifactsOrigin } from '../shared/aadhaar-core';
import { ui } from './page';
import type { ApproverMethod, Run } from './types';

/** Where the proving files come from, as the page's switch picks it. */
export const artifactsOrigin = (): ArtifactsOrigin => (ui.aadhaarOrigin.value === 'chunked' ? 'chunked' : 'server');

/** The certificate the QR's signature is checked under: the library's test certificate in testing mode, the pasted one otherwise. */
async function certificate(testing: boolean): Promise<string> {
  if (testing) {
    const pem = await testCertificate();

    pageTrace("the library's test certificate (testCertificateUrl)", `${pem.length} characters`);

    return pem;
  }

  const pasted = ui.aadhaarCertificate.value.trim();

  if (pasted === '') throw new Error('real mode: paste the production certificate (PEM) the QR is signed under');

  return pasted;
}

/** The seed and the certificate both calls take. */
async function params(run: Run): Promise<Params> {
  const seed = ui.aadhaarSeed.value.trim();

  if (!/^\d+$/.test(seed)) throw new Error('the nullifier seed is a decimal integer');

  return { nullifierSeed: BigInt(seed), issuerCertificate: await certificate(run.testing) };
}

/** The QR, a progress line with the time spent, and the Abort button's signal. */
function material(run: Run) {
  const qrData = ui.aadhaarQr.value.trim();
  const started = Date.now();

  if (qrData === '') throw new Error(run.testing ? 'paste a test QR from the anon-aadhaar generator' : 'paste the QR data of an Aadhaar card');

  return {
    material: {
      qrData,
      onProgress: (state: string) => {
        const seconds = Math.round((Date.now() - started) / 1000);

        ui.progressLine.textContent = `Prover: ${state} (${seconds} s)`;
        pageTrace(`onProgress: ${state} after ${seconds} s`);
      },
      signal: run.signal,
    },
  };
}

/** The Aadhaar method: the library's own test mode (test QR, test certificate, test key) or a real QR under the default stack. */
export const aadhaarPage: ApproverMethod = {
  testingLabel: "Testing mode: anon-aadhaar's test QR and test certificate; the proof is real and verify checks it against the test key",
  realLabel: "Real mode: a real Aadhaar QR and the production certificate, under the method's default stack",

  async enrolParams(run) {
    return await params(run);
  },

  async enrolMaterial(_input, run) {
    return material(run);
  },

  async signParams(_request, run) {
    return await params(run);
  },

  async signMaterial(_request, _input, run) {
    return material(run);
  },
};
