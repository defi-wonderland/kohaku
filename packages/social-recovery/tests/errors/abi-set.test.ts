import { describe, expect, it } from 'vitest';
import { decodeRevert, ERRORS_ABI, KIT_ERROR_SOURCES, type ErrorAbi, type Hex } from '../../src/index';
import { selectorOf } from '../helpers/keccak';
import { ERROR_STRING_SELECTOR, KIT_ROWS, PANIC_SELECTOR, revertData, samplesFor, signatureOf } from './rows';

const LANGUAGE_PAIR = ['Error(string)', 'Panic(uint256)'];

const exported: ErrorAbi = ERRORS_ABI;

describe('the exported error ABI set', () => {
  it('declares every one of the twenty-five kit errors with its argument names and types', () => {
    for (const entry of KIT_ROWS) {
      const found = exported.filter((item) => item.name === entry.name);

      expect(found, entry.name).toHaveLength(1);
      expect(found[0]?.type).toBe('error');
      expect(found[0]?.inputs.map((input) => [input.name, input.type])).toEqual(entry.inputs.map((input) => [input.name, input.type]));
    }
  });

  it('holds nothing beyond the twenty-five kit errors and the language pair', () => {
    const allowed = new Set([...KIT_ROWS.map(signatureOf), ...LANGUAGE_PAIR]);

    expect(exported.map(signatureOf).filter((signature) => !allowed.has(signature))).toEqual([]);
  });

  it('pins each row\'s selector to the Keccak-256 of its signature, computed by an independent hash', () => {
    for (const entry of KIT_ROWS) expect(selectorOf(signatureOf(entry)), entry.name).toBe(entry.selector);

    expect(selectorOf('Error(string)')).toBe(ERROR_STRING_SELECTOR);
    expect(selectorOf('Panic(uint256)')).toBe(PANIC_SELECTOR);
  });

  it('has as many distinct selectors as entries, so no entry repeats or collides', () => {
    expect(new Set(exported.map((item) => selectorOf(signatureOf(item)))).size).toBe(exported.length);
  });

  it.each(LANGUAGE_PAIR)('holds %s exactly once', (signature) => {
    expect(exported.filter((item) => signatureOf(item) === signature)).toHaveLength(1);
  });

  it('decodes every entry it exports, none of them under the reserved account source', () => {
    expect(KIT_ERROR_SOURCES).toContain('account');

    for (const item of exported) {
      const entry = { name: item.name, selector: selectorOf(signatureOf(item)) as Hex, source: 'manager' as const, inputs: item.inputs };
      const result = decodeRevert(revertData(entry, samplesFor(entry, 1)));

      expect(result.known, item.name).toBe(true);
      expect(result.known && result.source).not.toBe('account');
    }
  });
});
