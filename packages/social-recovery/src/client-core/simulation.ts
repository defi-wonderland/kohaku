import { CLIENT_CORE_SIMULATION_FROM } from '../constants';
import { decodeRevert } from '../errors';
import { assertArray, assertBool, assertBytes, assertObject, checkedBlock, lowerHex, normalizeAddress } from '../formats/guards';
import {
  isProviderRevert,
  SENDERS,
  type Address,
  type ClientConfiguration,
  type IProvider,
  type PinnedBlock,
  type PreparedBatch,
  type PreparedCall,
  type PrepareOptions,
  type SimulationResult,
} from '../interfaces';

/**
 * The address a call's simulation runs from: the account for a call the account sends, whatever `options.from` says;
 * else `options.from`, or `CLIENT_CORE_SIMULATION_FROM` where it is omitted.
 */
export function simulationFrom(call: PreparedCall, account: Address, options?: PrepareOptions): Address {
  assertObject(call, 'call');

  if (!SENDERS.includes(call.sender)) throw new TypeError(`call.sender must be one of ${SENDERS.join(', ')}`);

  if (call.sender === 'account') return normalizeAddress(account, 'account');

  return options?.from === undefined ? CLIENT_CORE_SIMULATION_FROM : normalizeAddress(options.from, 'options.from');
}

/** One `eth_call` of the prepared call at the block; a revert comes back decoded and any other failure rejects as itself. */
export async function simulateCall(
  provider: IProvider,
  call: PreparedCall,
  from: Address,
  block: PinnedBlock,
): Promise<SimulationResult> {
  assertObject(call, 'call');

  const target = normalizeAddress(call.target, 'call.target');

  assertBytes(call.data, 'call.data');

  const sender = normalizeAddress(from, 'from');
  const pinned = checkedBlock(block, 'block');

  try {
    await provider.call(target, lowerHex(call.data), sender, pinned.number);
  } catch (thrown) {
    if (!isProviderRevert(thrown)) throw thrown;

    return { success: false, from: sender, error: decodeRevert(thrown.data) };
  }

  return { success: true };
}

/** Whether two checked blocks are the same block. */
const sameBlock = (left: PinnedBlock, right: PinnedBlock): boolean => left.number === right.number && left.hash === right.hash;

/** The call with its simulation at the block, run from the address its sender calls for. */
const withSimulation = async (
  provider: IProvider,
  call: PreparedCall,
  account: Address,
  block: PinnedBlock,
  options: PrepareOptions | undefined,
): Promise<PreparedCall> => ({
  ...call,
  simulation: await simulateCall(provider, call, simulationFrom(call, account, options), block),
});

/**
 * The prepared record with a simulation on its call, or on every call of the batch one after the other in list order,
 * all at the record's block; unchanged where `options.simulate`, or else the configuration's default, is false.
 * A batch call pinned to another block than the batch's throws a `TypeError` before any call is simulated.
 */
export async function simulatePrepared<P extends PreparedCall | PreparedBatch>(
  provider: IProvider,
  prepared: P,
  account: Address,
  configuration: Pick<ClientConfiguration, 'simulate'>,
  options?: PrepareOptions,
): Promise<P> {
  assertObject(prepared, 'prepared');
  assertObject(configuration, 'configuration');

  if (options?.simulate !== undefined) assertBool(options.simulate, 'options.simulate');
  else assertBool(configuration.simulate, 'configuration.simulate');

  if (!(options?.simulate ?? configuration.simulate)) return prepared;

  const block = checkedBlock(prepared.block, 'prepared.block');

  if (prepared.kind === 'call') return (await withSimulation(provider, prepared, account, block, options)) as P;

  assertArray(prepared.calls, 'prepared.calls');

  const calls: PreparedCall[] = [];

  for (let index = 0; index < prepared.calls.length; index += 1) {
    const call = prepared.calls[index];

    assertObject(call, `prepared.calls[${index}]`);

    if (!sameBlock(checkedBlock(call.block, `prepared.calls[${index}].block`), block)) {
      throw new TypeError(`prepared.calls[${index}] is pinned to another block than the batch`);
    }
  }

  for (const call of prepared.calls) calls.push(await withSimulation(provider, call, account, block, options));

  return { ...prepared, calls } as P;
}
