import { FORMATS_SAFE_INTEGER_BITS } from '../constants';
import { assertUintNumber, checkedBlock } from '../formats/guards';
import type { BlockHeader, BlockTag, IProvider } from '../interfaces';
import type { PinnedHeader } from '../types';

/** The header's number, timestamp and lower-cased hash, refusing anything but non-negative safe integers and a 32-byte hash. */
export function checkedHeader(value: unknown, name: string): BlockHeader {
  const { number, hash } = checkedBlock(value, name);
  const { timestamp } = value as Partial<Record<keyof BlockHeader, unknown>>;

  assertUintNumber(timestamp, FORMATS_SAFE_INTEGER_BITS, `${name}.timestamp`);

  return { number, timestamp, hash };
}

/** The block the tag names at this moment, read once, keeping its timestamp beside the block every read is pinned to. */
export async function pinBlockHeader(provider: IProvider, tag: BlockTag): Promise<PinnedHeader> {
  const header = checkedHeader(await provider.block(tag), 'block header');

  return { header, block: { number: header.number, hash: header.hash } };
}
