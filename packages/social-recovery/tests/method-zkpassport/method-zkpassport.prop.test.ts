import fc from 'fast-check';
import { bytesToHex } from 'viem';
import { describe, expect, it } from 'vitest';
import { zkPassportMethod } from '../../src/method-zkpassport';
import type { Hex } from '../../src/interfaces';
import { encodeConfig, encodeFiveFieldConfig, encodeNestedConfig, encodeProof, stackDouble } from './fixtures';

const NUM_RUNS = Number(process.env['FC_NUM_RUNS'] ?? 256);

const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };

const { codec } = zkPassportMethod(stackDouble().stack);

const bytesArb = (minLength: number, maxLength: number) => fc.uint8Array({ minLength, maxLength }).map((bytes) => bytesToHex(bytes));

const wordArb = bytesArb(32, 32);

const textArb = fc.string({ unit: 'grapheme', maxLength: 80 });

const configArb = fc.record({
  uniqueIdentifier: wordArb,
  domain: textArb,
  scope: textArb,
  validityPeriodInSeconds: fc.bigInt({ min: 0n, max: (1n << 256n) - 1n }),
});

const proofArb = fc.record({
  vkeyHash: wordArb,
  proof: bytesArb(0, 300),
  publicInputs: fc.array(wordArb, { maxLength: 12 }),
  committedInputs: bytesArb(0, 200),
});

describe('method-zkpassport codec properties', () => {
  it('config: the codec encodes as viem encodes the pin\'s signature, and decodes back to the fields', () => {
    fc.assert(
      fc.property(configArb, (fields) => {
        const expected = encodeConfig(fields.uniqueIdentifier, fields.domain, fields.scope, fields.validityPeriodInSeconds);

        expect(codec.encodeConfig(fields)).toBe(expected);
        expect(codec.decodeConfig(expected)).toEqual(fields);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, 600_000);

  it('config: the same fields in the five-field or the nested layout are refused', () => {
    fc.assert(
      fc.property(configArb, wordArb, (fields, version) => {
        const { uniqueIdentifier, domain, scope, validityPeriodInSeconds } = fields;

        expect(() => codec.decodeConfig(encodeFiveFieldConfig(uniqueIdentifier, version, domain, scope, validityPeriodInSeconds))).toThrow();
        expect(() => codec.decodeConfig(encodeNestedConfig(uniqueIdentifier, domain, scope, validityPeriodInSeconds))).toThrow();
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, 600_000);

  it('proof: the codec encodes as viem encodes the proof layout, and decodes back to the fields', () => {
    fc.assert(
      fc.property(proofArb, ({ vkeyHash, proof, publicInputs, committedInputs }) => {
        const expected = encodeProof(vkeyHash, proof, publicInputs, committedInputs);
        const fields = { proofVerificationData: { vkeyHash, proof, publicInputs }, committedInputs };

        expect(codec.encodeProof(fields)).toBe(expected);

        const decoded = codec.decodeProof(expected);

        expect(decoded).toEqual(fields);
        expect(codec.encodeProof(decoded)).toBe(expected);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, 600_000);

  it('proof: a hole anywhere in publicInputs is refused with a TypeError naming its position', () => {
    fc.assert(
      fc.property(fc.array(wordArb, { minLength: 1, maxLength: 12 }), fc.nat(), (inputs, at) => {
        const position = at % inputs.length;
        const holed: Hex[] = inputs.slice();

        delete holed[position];

        let error: unknown;

        try {
          codec.encodeProof({ proofVerificationData: { vkeyHash: inputs[0] as Hex, proof: '0x', publicInputs: holed }, committedInputs: '0x' });
        } catch (caught) {
          error = caught;
        }

        expect(error).toBeInstanceOf(TypeError);
        expect((error as Error).message).toContain(`[${position}]`);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, 600_000);
});
