import type { Hex } from '@kohaku-eth/social-recovery';
import { isHex } from 'viem';

/** A node's message, carrying no revert data, for a call it could not run to its end. */
const RESOURCE_FAILURE = /gas required exceeds allowance|out of gas|exceeds block gas limit|gas limit reached/i;

/** A node's message for a revert that carried no bytes. */
const REVERTED = /execution reverted/i;

/** The JSON-RPC error code nodes give a reverted call. */
const REVERT_CODE = 3;

/** How deep a wallet may nest the node's error under `data` or `error`. */
const NEST_DEPTH = 4;

/** The keys a wallet nests the node's error under. */
const NESTED_KEYS = ['data', 'error'] as const;

const fieldOf = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined;

/** The error and every object nested in it under `data` or `error`, outermost first, as far as `NEST_DEPTH`. */
function layersOf(error: unknown): readonly object[] {
  const layers: object[] = [];
  let level: unknown[] = [error];

  for (let depth = 0; depth <= NEST_DEPTH && level.length > 0; depth += 1) {
    const objects = level.filter((entry): entry is object => typeof entry === 'object' && entry !== null);

    layers.push(...objects);
    level = objects.flatMap((entry) => NESTED_KEYS.map((key) => fieldOf(entry, key)));
  }

  return layers;
}

/** The first non-empty hex `data` string of any layer, the node's revert bytes. */
function bytesOf(layers: readonly object[]): Hex | undefined {
  for (const layer of layers) {
    const data = fieldOf(layer, 'data');

    if (typeof data === 'string' && isHex(data) && data !== '0x') return data;
  }

  return undefined;
}

/**
 * The raw revert bytes a failed `eth_call` carried, or `undefined` where the failure is not a confirmed revert.
 * Every layer the wallet nests under `data` or `error` is read for the bytes, the message and the code. Non-empty revert bytes are a revert whatever the message says; with none, a resource message is not a revert,
 * while code 3 or an `execution reverted` message is one with empty bytes; anything else is not a revert.
 */
export function revertData(error: unknown): Hex | undefined {
  const layers = layersOf(error);
  const data = bytesOf(layers);

  if (data !== undefined) return data;

  const message = layers.map((layer) => fieldOf(layer, 'message')).filter((entry) => typeof entry === 'string').join(' | ');

  if (RESOURCE_FAILURE.test(message)) return undefined;

  return layers.some((layer) => fieldOf(layer, 'code') === REVERT_CODE) || REVERTED.test(message) ? '0x' : undefined;
}
