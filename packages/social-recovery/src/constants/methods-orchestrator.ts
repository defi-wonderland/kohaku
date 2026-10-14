import type { DeviceBinding, ReplyFailure } from '../interfaces/records';

/** The failure answered for a method address no registered implementation serves. */
export const METHODS_ORCHESTRATOR_METHOD_UNSUPPORTED: ReplyFailure = Object.freeze({ kind: 'reply-failure', cause: 'method-unsupported' });

/** The failure answered for a request whose kind, version or purpose this build does not read. */
export const METHODS_ORCHESTRATOR_REQUEST_UNSUPPORTED: ReplyFailure = Object.freeze({ kind: 'reply-failure', cause: 'request-unsupported' });

/** The failure answered where this runtime cannot meet the implementation's device binding. */
export const METHODS_ORCHESTRATOR_DEVICE_UNAVAILABLE: ReplyFailure = Object.freeze({ kind: 'reply-failure', cause: 'device-unavailable' });

/** The binding every runtime meets, whether it names it or not, since it asks for no device. */
export const METHODS_ORCHESTRATOR_UNBOUND: DeviceBinding = 'none';

/** The members every registered method implementation must carry as functions. */
export const METHODS_ORCHESTRATOR_METHOD_MEMBERS: readonly string[] = Object.freeze([
  'modules',
  'enrollInput',
  'configFrom',
  'signingInput',
  'replyFrom',
  'verify',
  'describe',
]);

/** The members every method implementation's codec must carry as functions. */
export const METHODS_ORCHESTRATOR_METHOD_CODEC_MEMBERS: readonly string[] = Object.freeze([
  'encodeConfig',
  'decodeConfig',
  'encodeProof',
  'decodeProof',
]);

/** The members every registered action codec must carry as functions. */
export const METHODS_ORCHESTRATOR_ACTION_CODEC_MEMBERS: readonly string[] = Object.freeze(['encode', 'decode']);

/** The member a registry must carry as a function, besides being iterable. */
export const METHODS_ORCHESTRATOR_REGISTRY_MEMBERS: readonly string[] = Object.freeze(['get']);

/** Thrown, followed by the address, where no registered implementation serves the method. */
export const METHODS_ORCHESTRATOR_UNSERVED_METHOD_MESSAGE = 'methods orchestrator: no registered implementation serves method';

/** Thrown, followed by the binding, where this runtime cannot meet the implementation's device binding. */
export const METHODS_ORCHESTRATOR_UNMET_BINDING_MESSAGE = 'methods orchestrator: this runtime cannot meet the device binding';

/** Thrown where `verify` names a place other than the request's own. */
export const METHODS_ORCHESTRATOR_PLACE_MISMATCH_MESSAGE = 'place must be the request\'s own place';

/** Follows the registry or list name where it names one address or binding more than once. */
export const METHODS_ORCHESTRATOR_REPEAT_MESSAGE = 'names one entry more than once';

/** Follows the key's name where a registry keys an entry on the zero address. */
export const METHODS_ORCHESTRATOR_ZERO_KEY_MESSAGE = 'must not be the zero address';

/** Follows the key's name where an action codec is keyed on an address outside its own `actions`. */
export const METHODS_ORCHESTRATOR_FOREIGN_ACTION_MESSAGE = 'is not among its codec\'s actions';

/** Follows the value's name where it is not one of the closed values it must be. */
export const METHODS_ORCHESTRATOR_UNKNOWN_VALUE_MESSAGE = 'is not one of';

/** Follows the member's name where an implementation's `verify` answered something other than a verdict. */
export const METHODS_ORCHESTRATOR_VERDICT_ANSWER_MESSAGE = 'answered something other than a verdict';

/** Follows the member's name where an implementation answered neither hex bytes nor a typed failure with a known cause. */
export const METHODS_ORCHESTRATOR_BYTES_ANSWER_MESSAGE = 'answered neither hex bytes nor a reply failure with a known cause';

/** Follows the member's name where an implementation's `signingInput` answered something other than an object. */
export const METHODS_ORCHESTRATOR_INPUT_ANSWER_MESSAGE = 'answered something other than an object';

/** Follows the member's name where an implementation's `enrollInput` answered neither a ceremony nor nothing to perform. */
export const METHODS_ORCHESTRATOR_ENROLL_ANSWER_MESSAGE = 'answered neither a ceremony nor nothing to perform';

/** The kinds an implementation's `enrollInput` may answer. */
export const METHODS_ORCHESTRATOR_ENROLL_KINDS: readonly string[] = Object.freeze(['nothing-to-perform', 'ceremony']);
