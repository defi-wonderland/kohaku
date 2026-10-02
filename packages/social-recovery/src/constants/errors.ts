import type { AbiErrorItem, AbiParameter, ErrorAbi, KitErrorSource } from '../interfaces/records';

const input = (name: string, type: string): AbiParameter => ({ name, type });

const error = (name: string, ...inputs: readonly AbiParameter[]): AbiErrorItem => ({ type: 'error', name, inputs });

/** The recovery manager's errors, written by hand from its Solidity declarations. */
export const ERRORS_MANAGER_ABI: ErrorAbi = [
  error('InvalidCommitment', input('supplied', 'bytes32')),
  error('WrongSetupNonce', input('supplied', 'uint64'), input('expected', 'uint64')),
  error('MethodStopped', input('place', 'uint256'), input('method', 'address')),
  error('MethodVetoedSpend', input('method', 'address')),
  error('MethodNotUsed', input('attemptId', 'uint64'), input('method', 'address')),
  error('AttemptIgnoresPause', input('attemptId', 'uint64')),
  error('MethodNotStopped', input('method', 'address')),
  error('PlaceOutOfRange', input('place', 'uint256'), input('count', 'uint256')),
  error('NoSetup', input('account', 'address'), input('action', 'address')),
  error('NoActiveAttempt', input('account', 'address'), input('action', 'address')),
  error('AttemptAlreadyActive', input('account', 'address'), input('action', 'address'), input('attemptId', 'uint64')),
  error('WrongAttemptId', input('supplied', 'uint64'), input('expected', 'uint64')),
  error('SetupCommitmentMismatch', input('recomputed', 'bytes32'), input('committed', 'bytes32')),
  error('StaleAttempt', input('judgedUnder', 'uint64'), input('currentNonce', 'uint64')),
  error('CredentialMismatch', input('place', 'uint256'), input('recomputed', 'bytes32')),
  error('PlacesNotStrictlyIncreasing', input('place', 'uint256')),
  error('RequestExpired', input('blockTimestamp', 'uint48'), input('validUntil', 'uint48')),
  error('ProofRejected', input('place', 'uint256'), input('method', 'address')),
  error('RuleUnsatisfied', input('clause', 'uint256')),
  error('WaitNotOver', input('blockTimestamp', 'uint48'), input('consumableAfter', 'uint48')),
  error('WrongPayload', input('supplied', 'bytes32'), input('committed', 'bytes32')),
];

/** The recovery action contract's errors; `state` is the manager's `AttemptState` enum, encoded as `uint8`. */
export const ERRORS_ACTION_ABI: ErrorAbi = [
  error('BatchNotApproved', input('callIndex', 'uint256')),
  error('MalformedHandover', input('payload', 'bytes')),
  error('ReservedAuthority', input('authority', 'address')),
  error(
    'NotConsumable',
    input('account', 'address'),
    input('state', 'uint8'),
    input('consumableAfter', 'uint48'),
    input('committedPayloadHash', 'bytes32'),
  ),
];

/** The account's own errors; empty until the account revision the action serves is pinned. */
export const ERRORS_ACCOUNT_ABI: ErrorAbi = [];

/** The two errors the Solidity language itself raises. */
export const ERRORS_LANGUAGE_ABI: ErrorAbi = [error('Panic', input('reason', 'uint256')), error('Error', input('message', 'string'))];

/** The error ABI set by the source that raises each error. */
export const ERRORS_ABI_BY_SOURCE: { readonly [Source in KitErrorSource]: ErrorAbi } = {
  manager: ERRORS_MANAGER_ABI,
  action: ERRORS_ACTION_ABI,
  account: ERRORS_ACCOUNT_ABI,
  language: ERRORS_LANGUAGE_ABI,
};

/** Every error `decodeRevert` names, exported for a decoder the SDK does not reach. */
export const ERRORS_ABI: ErrorAbi = [...ERRORS_MANAGER_ABI, ...ERRORS_ACTION_ABI, ...ERRORS_ACCOUNT_ABI, ...ERRORS_LANGUAGE_ABI];

/** The width of an error selector, in bytes. */
export const ERRORS_SELECTOR_SIZE = 4;
