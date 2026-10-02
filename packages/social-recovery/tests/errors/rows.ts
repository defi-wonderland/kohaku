import { encodeAbiParameters, getAddress, type AbiParameter } from 'viem';
import type { Hex, KitErrorSource, KitErrorValue } from '../../src/index';

/** One expected error: its selector computed from the signature text, its arguments as name and type, and who raises it. */
export type ErrorRow = {
  readonly name: string;
  readonly selector: Hex;
  readonly inputs: readonly { readonly name: string; readonly type: string }[];
  readonly source: KitErrorSource;
};

const row = (name: string, selector: Hex, source: KitErrorSource, inputs: readonly (readonly [string, string])[]): ErrorRow => ({
  name,
  selector,
  source,
  inputs: inputs.map(([argument, type]) => ({ name: argument, type })),
});

/** The manager's twenty-one errors. */
export const MANAGER_ROWS: readonly ErrorRow[] = [
  row('InvalidCommitment', '0x537fbfab', 'manager', [['supplied', 'bytes32']]),
  row('WrongSetupNonce', '0x79d95968', 'manager', [['supplied', 'uint64'], ['expected', 'uint64']]),
  row('PlaceOutOfRange', '0xfccf8ba3', 'manager', [['place', 'uint256'], ['count', 'uint256']]),
  row('NoSetup', '0x4ed09422', 'manager', [['account', 'address'], ['action', 'address']]),
  row('NoActiveAttempt', '0x083c73d3', 'manager', [['account', 'address'], ['action', 'address']]),
  row('AttemptAlreadyActive', '0x659a6529', 'manager', [['account', 'address'], ['action', 'address'], ['attemptId', 'uint64']]),
  row('WrongAttemptId', '0xd7faf9c3', 'manager', [['supplied', 'uint64'], ['expected', 'uint64']]),
  row('SetupCommitmentMismatch', '0x1a88ff56', 'manager', [['recomputed', 'bytes32'], ['committed', 'bytes32']]),
  row('StaleAttempt', '0x6e095a46', 'manager', [['judgedUnder', 'uint64'], ['currentNonce', 'uint64']]),
  row('CredentialMismatch', '0x5460a018', 'manager', [['place', 'uint256'], ['recomputed', 'bytes32']]),
  row('PlacesNotStrictlyIncreasing', '0x241d94cd', 'manager', [['place', 'uint256']]),
  row('RequestExpired', '0x42a2e33c', 'manager', [['blockTimestamp', 'uint48'], ['validUntil', 'uint48']]),
  row('ProofRejected', '0xa5f5e92a', 'manager', [['place', 'uint256'], ['method', 'address']]),
  row('MethodStopped', '0x4ba81865', 'manager', [['place', 'uint256'], ['method', 'address']]),
  row('MethodVetoedSpend', '0x8721dfbf', 'manager', [['method', 'address']]),
  row('MethodNotUsed', '0x0e15d63a', 'manager', [['attemptId', 'uint64'], ['method', 'address']]),
  row('AttemptIgnoresPause', '0x7d6d61b3', 'manager', [['attemptId', 'uint64']]),
  row('MethodNotStopped', '0x9a5410d8', 'manager', [['method', 'address']]),
  row('RuleUnsatisfied', '0xd3bd0752', 'manager', [['clause', 'uint256']]),
  row('WaitNotOver', '0x55dc11ee', 'manager', [['blockTimestamp', 'uint48'], ['consumableAfter', 'uint48']]),
  row('WrongPayload', '0x5c5cb894', 'manager', [['supplied', 'bytes32'], ['committed', 'bytes32']]),
];

/** The action contract's four errors; the attempt state travels as the enum's `uint8`. */
export const ACTION_ROWS: readonly ErrorRow[] = [
  row('BatchNotApproved', '0x16f1317c', 'action', [['callIndex', 'uint256']]),
  row('MalformedHandover', '0x2c35b8b1', 'action', [['payload', 'bytes']]),
  row('ReservedAuthority', '0x58c9302f', 'action', [['authority', 'address']]),
  row('NotConsumable', '0x6c5e8cd1', 'action', [
    ['account', 'address'],
    ['state', 'uint8'],
    ['consumableAfter', 'uint48'],
    ['committedPayloadHash', 'bytes32'],
  ]),
];

/** One argument as the encoder takes it. */
export type ArgumentValue = bigint | string;

/** The kit's twenty-five declared errors. */
export const KIT_ROWS: readonly ErrorRow[] = [...MANAGER_ROWS, ...ACTION_ROWS];

/** The language pair's selectors, well known outside the kit. */
export const ERROR_STRING_SELECTOR: Hex = '0x08c379a0';
export const PANIC_SELECTOR: Hex = '0x4e487b71';

/** The canonical signature of a row, the text its selector hashes. */
export const signatureOf = (entry: { readonly name: string; readonly inputs: readonly { readonly type: string }[] }): string =>
  `${entry.name}(${entry.inputs.map((input) => input.type).join(',')})`;

const word = (seed: number, fill: string): string => fill.repeat(64 - 2) + seed.toString(16).padStart(2, '0');

/** A sample value per argument type, its lower-case address spelling exercising the checksum on the way out. */
export function sampleValue(type: string, seed: number): ArgumentValue {
  if (type === 'string') return `sample ${seed}`;

  if (type === 'address') return `0x${'ab'.repeat(19)}${seed.toString(16).padStart(2, '0')}`;

  if (type === 'bytes32') return `0x${word(seed, 'c')}`;

  if (type === 'bytes') return `0xdeadbeef${seed.toString(16).padStart(2, '0')}`;

  if (type === 'uint8') return BigInt(seed % 4);

  const bits = Number(type.slice('uint'.length));

  return (1n << BigInt(bits)) - 1n - BigInt(seed);
}

/** The value `decodeRevert` must hand back for a sample: integers as bigint, addresses checksummed, bytes lower case. */
export function expectedValue(type: string, value: ArgumentValue): KitErrorValue {
  if (type === 'address') return getAddress(value as Hex);

  if (typeof value === 'string') return type === 'string' ? value : value.toLowerCase();

  return value;
}

/** The revert data the chain would return for a row and its values, encoded with viem from the pinned row alone. */
export function revertData(entry: ErrorRow, values: readonly ArgumentValue[]): Hex {
  const encoded = encodeAbiParameters(entry.inputs as readonly AbiParameter[], values);

  return `${entry.selector}${encoded.slice(2)}`;
}

/** Sample values for every argument of a row, one seed per row. */
export const samplesFor = (entry: ErrorRow, seed: number): ArgumentValue[] =>
  entry.inputs.map((input, index) => sampleValue(input.type, seed + index));
