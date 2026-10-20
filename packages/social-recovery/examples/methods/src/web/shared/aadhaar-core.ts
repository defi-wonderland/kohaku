import type {
  AadhaarPcd,
  AadhaarProgress,
  AadhaarProverArgs,
  AnonAadhaarArtifacts,
  AnonAadhaarMethodOptions,
  AnonAadhaarStack,
} from '@kohaku-eth/social-recovery/recovery-methods';

/** Where the proving files are fetched from: one download of the proving key, or its published chunks. */
export type ArtifactsOrigin = 'server' | 'chunked';

/** The members of `@anon-aadhaar/core` 2.4.3 the playground calls; the package ships raw TypeScript as its types. */
type AadhaarCore = {
  readonly init: (args: unknown) => Promise<void>;
  readonly generateArgs: (options: unknown) => Promise<AadhaarProverArgs>;
  readonly prove: (args: unknown, onProgress?: AadhaarProgress) => Promise<AadhaarPcd>;
  readonly verify: (pcd: unknown, useTestAadhaar?: boolean) => Promise<boolean>;
  readonly ArtifactsOrigin: Readonly<Record<string, number>>;
  readonly artifactUrls: { readonly v2: { readonly wasm: string; readonly zkey: string; readonly vk: string; readonly chunked: string } };
  readonly testCertificateUrl: string;
};

let loading: Promise<AadhaarCore> | undefined;

/** The installed `@anon-aadhaar/core`, imported once on first use; a CommonJS bundle may hand its members over under `default`. */
export function loadCore(): Promise<AadhaarCore> {
  loading ??= import('@anon-aadhaar/core' as string).then((imported: { default?: AadhaarCore } & Partial<AadhaarCore>) =>
    typeof imported.init === 'function' ? (imported as AadhaarCore) : (imported.default as AadhaarCore),
  );

  return loading;
}

/** The library's published v2 proving files, fetched at run time from its own bucket, never bundled. */
export async function v2Artifacts(origin: ArtifactsOrigin): Promise<AnonAadhaarArtifacts> {
  const urls = (await loadCore()).artifactUrls.v2;

  return { wasmURL: urls.wasm, zkeyURL: origin === 'chunked' ? urls.chunked : urls.zkey, vkeyURL: urls.vk, artifactsOrigin: origin };
}

/** The library's test certificate, fetched from the URL its own constant names. */
export async function testCertificate(): Promise<string> {
  const response = await fetch((await loadCore()).testCertificateUrl);

  if (!response.ok) throw new Error(`the test certificate did not download: HTTP ${response.status}`);

  return await response.text();
}

/**
 * The library's own test mode as a stack: the installed core, initialised with the v2 files, proving unchanged, and
 * verifying with its test flag so a proof over a test QR checks against anon-aadhaar's test key instead of the production one.
 */
export function testModeStack(origin: ArtifactsOrigin): AnonAadhaarStack {
  let ready: Promise<AadhaarCore> | undefined;

  const core = (): Promise<AadhaarCore> => {
    ready ??= (async () => {
      const loaded = await loadCore();
      const artifacts = await v2Artifacts(origin);

      await loaded.init({ ...artifacts, artifactsOrigin: loaded.ArtifactsOrigin[origin] });

      return loaded;
    })().catch((error: unknown) => {
      ready = undefined;

      throw error;
    });

    return ready;
  };

  return {
    generateArgs: async (options) => (await core()).generateArgs({ ...options, fieldsToRevealArray: [...options.fieldsToRevealArray] }),
    prove: async (args, onProgress) => (await core()).prove(args, onProgress),
    verify: async (pcd) => (await core()).verify(pcd, true),
  };
}

/** The Aadhaar method's options: the test-mode stack, or the method's default stack over the v2 files for a real QR. */
export const aadhaarOptions = async (testing: boolean, origin: ArtifactsOrigin): Promise<AnonAadhaarMethodOptions> =>
  testing ? { stack: testModeStack(origin) } : { artifacts: await v2Artifacts(origin) };
