import type { Hex } from '@kohaku-eth/social-recovery';
import { isHex } from 'viem';

/** A node's message, carrying no revert data, for a call it could not run to its end. */
const RESOURCE_FAILURE = /gas required exceeds allowance|out of gas|exceeds block gas limit|gas limit reached/i;

/** A node's message for a revert that carried no bytes. */
const REVERTED = /execution reverted/i;

/** The JSON-RPC error code nodes give a reverted call. */
const REVERT_CODE = 3;

/** How deep a wallet may nest the node's error under `data`. */
const DATA_DEPTH = 4;

const fieldOf = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined;

/** The first hex `data` along the error's `data` chain, the node's revert bytes. */
function dataOf(error: unknown): Hex | undefined {
  let data = fieldOf(error, 'data');

  for (let depth = 0; depth < DATA_DEPTH && data !== undefined; depth += 1) {
    if (typeof data === 'string') return isHex(data) ? data : undefined;

    data = fieldOf(data, 'data');
  }

  return undefined;
}

/** Every `message` along the error's `data` chain, joined, so a wallet's wrapper does not hide the node's words. */
function messagesOf(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth <= DATA_DEPTH && typeof current === 'object' && current !== null; depth += 1) {
    const message = fieldOf(current, 'message');

    if (typeof message === 'string') messages.push(message);

    current = fieldOf(current, 'data');
  }

  return messages.join(' | ');
}

/**
 * The raw revert bytes a failed `eth_call` carried, or `undefined` where the failure is not a confirmed revert.
 * Non-empty revert bytes are a revert whatever the message says; with none, a resource message is not a revert,
 * while code 3 or an `execution reverted` message is one with empty bytes; anything else is not a revert.
 */
export function revertData(error: unknown): Hex | undefined {
  const data = dataOf(error);

  if (data !== undefined && data !== '0x') return data;

  const message = messagesOf(error);

  if (RESOURCE_FAILURE.test(message)) return undefined;

  return fieldOf(error, 'code') === REVERT_CODE || REVERTED.test(message) ? '0x' : undefined;
}
