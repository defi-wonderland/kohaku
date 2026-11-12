import { sha256 } from 'viem';
import { METHOD_AADHAAR_BUCKET_CHUNKED } from '../constants/method-aadhaar-bucket';
import type { Hex } from '../interfaces';
import type { AadhaarArtifactHashes, AnonAadhaarArtifacts } from '../types/method-aadhaar';

/** Whether the wasm and vkey URLs are the SDK's own bucket files, the only ones whose hashes this build pins. */
const namesBucketFiles = (artifacts: AnonAadhaarArtifacts): boolean =>
  artifacts.wasmURL === METHOD_AADHAAR_BUCKET_CHUNKED.wasmURL && artifacts.vkeyURL === METHOD_AADHAAR_BUCKET_CHUNKED.vkeyURL;

/** The bytes at the URL where the fetch answers and their sha256 is `expected`, else `undefined`. */
async function verifiedBytes(url: string, expected: Hex): Promise<Uint8Array<ArrayBuffer> | undefined> {
  try {
    const response = await fetch(url);

    if (!response.ok) return undefined;

    const bytes = new Uint8Array(await response.arrayBuffer());

    return sha256(bytes) === expected.toLowerCase() ? bytes : undefined;
  } catch {
    return undefined;
  }
}

const objectUrl = (bytes: Uint8Array<ArrayBuffer>): string => URL.createObjectURL(new Blob([bytes]));

/**
 * The artifacts to initialise the peer with: for the SDK's own bucket the wasm and vkey, fetched once, checked against
 * `expected` and held in memory behind object URLs, with the zkey URL unchanged; any other artifacts unchanged and unfetched.
 * `undefined` where a bucket file fails its fetch or its check.
 */
export async function pinnedArtifacts(
  artifacts: AnonAadhaarArtifacts,
  expected: Pick<AadhaarArtifactHashes, 'wasm' | 'vkey'>,
): Promise<AnonAadhaarArtifacts | undefined> {
  if (!namesBucketFiles(artifacts)) return artifacts;

  const [wasm, vkey] = await Promise.all([verifiedBytes(artifacts.wasmURL, expected.wasm), verifiedBytes(artifacts.vkeyURL, expected.vkey)]);

  if (wasm === undefined || vkey === undefined) return undefined;

  try {
    return { ...artifacts, wasmURL: objectUrl(wasm), vkeyURL: objectUrl(vkey) };
  } catch {
    return undefined;
  }
}
