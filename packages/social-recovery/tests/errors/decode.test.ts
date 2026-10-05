import { encodeAbiParameters } from 'viem';
import { describe, expect, it } from 'vitest';
import { decodeRevert, type Hex } from '../../src/index';
import {
  ACTION_ROWS,
  ERROR_STRING_SELECTOR,
  expectedValue,
  KIT_ROWS,
  MANAGER_ROWS,
  PANIC_SELECTOR,
  revertData,
  samplesFor,
} from './rows';

describe('decodeRevert names every declared error with its arguments', () => {
  it.each(KIT_ROWS.map((entry, index) => [entry.name, entry, index] as const))('%s', (_name, entry, index) => {
    const values = samplesFor(entry, index * 7 + 1);
    const result = decodeRevert(revertData(entry, values));
    const args = Object.fromEntries(entry.inputs.map((input, at) => [input.name, expectedValue(input.type, values[at] ?? 0n)]));

    expect(result).toEqual({ known: true, source: entry.source, name: entry.name, selector: entry.selector, args });
  });

  it('attributes the twenty-one manager rows to the manager and the four action rows to the action', () => {
    expect(MANAGER_ROWS).toHaveLength(21);
    expect(ACTION_ROWS).toHaveLength(4);

    for (const entry of KIT_ROWS) {
      const result = decodeRevert(revertData(entry, samplesFor(entry, 3)));

      expect(result.known && result.source).toBe(entry.source);
    }
  });

  it('decodes every integer argument as a bigint, including the extremes of its width', () => {
    for (const extreme of ['max', 'zero'] as const) {
      for (const entry of KIT_ROWS) {
        const samples = samplesFor(entry, 5);
        const fixed = entry.inputs.map((input, at) => {
          if (!input.type.startsWith('uint')) return samples[at] ?? 0n;

          return extreme === 'zero' ? 0n : (1n << BigInt(Number(input.type.slice('uint'.length)))) - 1n;
        });
        const result = decodeRevert(revertData(entry, fixed));

        expect(result.known).toBe(true);

        if (!result.known) continue;

        entry.inputs.forEach((input, at) => {
          if (input.type.startsWith('uint')) expect(result.args[input.name]).toBe(fixed[at]);
        });
      }
    }
  });

  it('reads NotConsumable\'s attempt state as the enum\'s integer', () => {
    const notConsumable = ACTION_ROWS.find((entry) => entry.name === 'NotConsumable');

    if (notConsumable === undefined) throw new Error('fixture lacks NotConsumable');

    const account: Hex = '0x1111111111111111111111111111111111111111';
    const hash: Hex = `0x${'ef'.repeat(32)}`;
    const result = decodeRevert(revertData(notConsumable, [account, 2n, 1_800_000_000n, hash]));

    expect(result).toMatchObject({ known: true, args: { account, state: 2n, consumableAfter: 1_800_000_000n, committedPayloadHash: hash } });
  });

  it('returns the bytes argument of MalformedHandover as lower-case hex, empty bytes included', () => {
    const malformed = ACTION_ROWS.find((entry) => entry.name === 'MalformedHandover');

    if (malformed === undefined) throw new Error('fixture lacks MalformedHandover');

    expect(decodeRevert(revertData(malformed, ['0xABCDEF']))).toMatchObject({ args: { payload: '0xabcdef' } });
    expect(decodeRevert(revertData(malformed, ['0x']))).toMatchObject({ known: true, args: { payload: '0x' } });
  });
});

describe('decodeRevert names the language pair', () => {
  const errorString = (message: string): Hex =>
    `${ERROR_STRING_SELECTOR}${encodeAbiParameters([{ type: 'string' }], [message]).slice(2)}`;
  const panic = (code: bigint): Hex => `${PANIC_SELECTOR}${encodeAbiParameters([{ type: 'uint256' }], [code]).slice(2)}`;

  it('decodes Error(string) as a language error carrying its one message', () => {
    const result = decodeRevert(errorString('not allowed'));

    expect(result).toMatchObject({ known: true, source: 'language', name: 'Error', selector: ERROR_STRING_SELECTOR });
    expect(result.known && result.args).toEqual({ message: 'not allowed' });
  });

  it('decodes the arithmetic overflow Panic(uint256) code 0x11 as a bigint', () => {
    const result = decodeRevert(panic(0x11n));

    expect(result).toMatchObject({ known: true, source: 'language', name: 'Panic', selector: PANIC_SELECTOR });
    expect(result.known && result.args).toEqual({ reason: 0x11n });
  });

  it('decodes an empty Error(string) message', () => {
    const result = decodeRevert(errorString(''));

    expect(result.known && Object.values(result.args)).toEqual(['']);
  });
});
