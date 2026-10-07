import { assertArray, assertBytes32, assertObject, normalizeAddress, sameAddress } from '../formats/guards';
import type { PinnedBlock } from '../interfaces';
import type { CheckedRemovedKeyInputs, RemovedKeyInputs } from '../types/removed-key';

/** Refuses anything but a non-negative safe integer, with a `TypeError`. */
function assertBlockNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
}

/** Refuses anything but a block number and a 32-byte hash. */
export function assertPinnedBlock(value: unknown, name: string): asserts value is PinnedBlock {
  assertObject(value, name);

  const { number, hash } = value as Partial<Record<keyof PinnedBlock, unknown>>;

  assertBlockNumber(number, `${name}.number`);
  assertBytes32(hash, `${name}.hash`);
}

/** The inputs with every address checksummed, refusing malformed ones with a `TypeError` before anything is read. */
export function checkedInputs(inputs: unknown): CheckedRemovedKeyInputs {
  assertObject(inputs, 'inputs');

  const given = inputs as RemovedKeyInputs;
  const supplied = given.supplied === undefined ? undefined : normalizeAddress(given.supplied, 'inputs.supplied');
  const account = normalizeAddress(given.account, 'inputs.account');
  const actionAddress = normalizeAddress(given.actionAddress, 'inputs.actionAddress');

  assertObject(given.descriptor, 'inputs.descriptor');
  assertBlockNumber(given.descriptor.deployedAt, 'inputs.descriptor.deployedAt');
  assertObject(given.codec, 'inputs.codec');
  assertArray(given.codec.actions, 'inputs.codec.actions');

  const served = given.codec.actions.map((entry, index) => normalizeAddress(entry, `inputs.codec.actions[${index}]`));

  if (!served.some((entry) => sameAddress(entry, actionAddress))) {
    throw new TypeError(`inputs.codec does not serve action ${actionAddress}`);
  }

  return { ...given, supplied, account, actionAddress };
}
