import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import * as core from '../../src';
import * as constants from '../../src/constants';
import * as recoveryMethods from '../../src/recovery-methods';
import { PACKAGE_ROOT } from '../helpers/source';

type PeerUrls = { readonly wasm: string; readonly zkey: string; readonly vk: string; readonly chunked: string };

const peer = (await vi.importActual('@anon-aadhaar/core')) as { readonly artifactUrls: { readonly v2: PeerUrls } };
const V2 = peer.artifactUrls.v2;

const BUCKET_NAMES = [
  'METHOD_AADHAAR_BUCKET_URL',
  'METHOD_AADHAAR_BUCKET_CHUNKED',
  'METHOD_AADHAAR_BUCKET_SERVER',
  'METHOD_AADHAAR_DEFAULT_ARTIFACTS',
  'METHOD_AADHAAR_NO_ARTIFACTS_MESSAGE',
] as const;

const named = (entry: object): { readonly [name: string]: unknown } => entry as { readonly [name: string]: unknown };

describe('the bucket constants', () => {
  it('the chunked bucket is the peer\'s v2 wasm, chunked zkey folder and vkey, under the chunked origin, frozen', () => {
    expect(constants.METHOD_AADHAAR_BUCKET_CHUNKED).toStrictEqual({ wasmURL: V2.wasm, zkeyURL: V2.chunked, vkeyURL: V2.vk, artifactsOrigin: 'chunked' });
    expect(Object.isFrozen(constants.METHOD_AADHAAR_BUCKET_CHUNKED)).toBe(true);
  });

  it('the server bucket is the peer\'s v2 wasm, whole zkey and vkey, under the server origin, frozen', () => {
    expect(constants.METHOD_AADHAAR_BUCKET_SERVER).toStrictEqual({ wasmURL: V2.wasm, zkeyURL: V2.zkey, vkeyURL: V2.vk, artifactsOrigin: 'server' });
    expect(Object.isFrozen(constants.METHOD_AADHAAR_BUCKET_SERVER)).toBe(true);
  });

  it('the default is the chunked bucket, the same object', () => {
    expect(constants.METHOD_AADHAAR_DEFAULT_ARTIFACTS).toBe(constants.METHOD_AADHAAR_BUCKET_CHUNKED);
  });

  it('every URL of both records sits under the bucket URL, which is the peer\'s v2 folder', () => {
    const base = constants.METHOD_AADHAAR_BUCKET_URL;

    expect(V2.wasm.startsWith(`${base}/`)).toBe(true);

    for (const record of [constants.METHOD_AADHAAR_BUCKET_CHUNKED, constants.METHOD_AADHAAR_BUCKET_SERVER]) {
      for (const url of [record.wasmURL, record.zkeyURL, record.vkeyURL]) expect(url.startsWith(`${base}/`), url).toBe(true);
    }
  });

  it('both origins are among the accepted origins', () => {
    expect(constants.METHOD_AADHAAR_ARTIFACT_ORIGINS).toEqual(expect.arrayContaining(['chunked', 'server']));
  });

  it('the no-artifacts message is still exported, a non-empty string', () => {
    expect(typeof constants.METHOD_AADHAAR_NO_ARTIFACTS_MESSAGE).toBe('string');
    expect(constants.METHOD_AADHAAR_NO_ARTIFACTS_MESSAGE.length).toBeGreaterThan(0);
  });
});

describe('the bucket constants on both entries', () => {
  it.each(BUCKET_NAMES)('%s is exported by the core entry and by ./recovery-methods as the same value', (name) => {
    const value = named(constants)[name];

    expect(value).toBeDefined();
    expect(named(core)[name]).toBe(value);
    expect(named(recoveryMethods)[name]).toBe(value);
  });
});

const DIST = join(PACKAGE_ROOT, 'dist');

describe('the bucket constants in the built output (needs a build first)', () => {
  it.each(['index.js', 'recovery-methods.js'])('%s exports each bucket constant with the source value', async (file) => {
    expect(existsSync(join(DIST, file))).toBe(true);

    const built = named(await import(pathToFileURL(join(DIST, file)).href));

    for (const name of BUCKET_NAMES) expect(built[name], name).toStrictEqual(named(constants)[name]);
  });
});
