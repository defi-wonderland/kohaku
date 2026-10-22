import { beforeEach, describe, expect, it, vi } from 'vitest';
import { METHOD_AADHAAR_STACK_AND_ARTIFACTS_MESSAGE } from '../../src/constants/method-aadhaar';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import { CERTIFICATE, configBytes, ctxFor, isFailure, nine, proofBytes, QR_DATA, signalsFor, stackDouble } from './fixtures';

const core = vi.hoisted(() => ({
  init: vi.fn((): Promise<void> => Promise.reject(new Error('fetch failed: https://unreachable.invalid/circuit.wasm'))),
  generateArgs: vi.fn((): Promise<unknown> => Promise.resolve({})),
  prove: vi.fn((): Promise<unknown> => Promise.resolve({})),
  verify: vi.fn<(pcd: unknown, testMode?: boolean) => Promise<boolean>>(() => Promise.resolve(true)),
}));

vi.mock('@anon-aadhaar/core', () => ({
  ...core,
  ArtifactsOrigin: { server: 0, local: 1, chunked: 2 },
}));

/** The proof vector's digest. */
const DIGEST = '0x17498ba208aefe001e6e2f2adec41cd16d0285e23660df6e310d3daac040c339';
const PARAMS = { nullifierSeed: 77n, issuerCertificate: CERTIFICATE };
const ARTIFACTS = {
  wasmURL: 'https://unreachable.invalid/circuit.wasm',
  zkeyURL: 'https://unreachable.invalid/circuit.zkey',
  vkeyURL: 'https://unreachable.invalid/vkey.json',
  artifactsOrigin: 'server',
} as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a stack whose init rejects', () => {
  it('configFrom is device-unavailable and the prover is never called', async () => {
    const method = anonAadhaarMethod({ artifacts: ARTIFACTS });
    const config = await method.configFrom(method.enrollInput(PARAMS), { qrData: QR_DATA });

    expect(isFailure(config, 'device-unavailable')).toBe(true);
    expect(core.init).toHaveBeenCalledTimes(1);
    expect(core.generateArgs).not.toHaveBeenCalled();
    expect(core.prove).not.toHaveBeenCalled();
  });

  it('replyFrom is device-unavailable and the prover is never called', async () => {
    const method = anonAadhaarMethod({ artifacts: ARTIFACTS });
    const ctx = ctxFor(configBytes(22n, 77n), DIGEST);
    const reply = await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA });

    expect(isFailure(reply, 'device-unavailable')).toBe(true);
    expect(core.init).toHaveBeenCalledTimes(1);
    expect(core.generateArgs).not.toHaveBeenCalled();
    expect(core.prove).not.toHaveBeenCalled();
  });
});

describe('the default stack passes the test-mode flag to the peer\'s verify', () => {
  const ctx = ctxFor(configBytes(22n, 77n), DIGEST);
  const proof = proofBytes({
    a: [1n, 2n],
    b: [
      [4n, 3n],
      [6n, 5n],
    ],
    c: [7n, 8n],
    inputs: nine(signalsFor(22n, 77n, DIGEST)),
  });

  it.each([
    ['by default', { artifacts: ARTIFACTS }, false],
    ['under testMode: false', { artifacts: ARTIFACTS, testMode: false }, false],
    ['under testMode: true', { artifacts: ARTIFACTS, testMode: true }, true],
  ] as const)('%s the peer receives (pcd, %s) and its true answer is satisfied', async (_why, options, flag) => {
    core.init.mockResolvedValueOnce(undefined);

    expect(await anonAadhaarMethod(options).verify(ctx, proof)).toBe('satisfied');
    expect(core.verify).toHaveBeenCalledTimes(1);
    expect(core.verify.mock.calls[0]).toEqual([expect.objectContaining({ proof: expect.objectContaining({ nullifier: '22' }) }), flag]);
  });

  it('a peer that throws on the key is not-judged under test mode', async () => {
    core.init.mockResolvedValueOnce(undefined);
    core.verify.mockRejectedValueOnce(new Error('VerificationError: public key mismatch.'));

    expect(await anonAadhaarMethod({ artifacts: ARTIFACTS, testMode: true }).verify(ctx, proof)).toBe('not-judged');
  });

  it('{ stack, testMode } is allowed and never imports the peer; { stack, artifacts } is refused as before', async () => {
    const double = stackDouble({ verify: true });

    expect(await anonAadhaarMethod({ stack: double.stack, testMode: true }).verify(ctx, proof)).toBe('satisfied');
    expect(double.verifyFlags).toEqual([true]);
    expect(core.init).not.toHaveBeenCalled();
    expect(core.verify).not.toHaveBeenCalled();
    expect(() => anonAadhaarMethod({ stack: double.stack, artifacts: ARTIFACTS })).toThrow(new TypeError(METHOD_AADHAAR_STACK_AND_ARTIFACTS_MESSAGE));
  });
});
