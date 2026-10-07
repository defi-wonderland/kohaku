import type { Hex } from '../interfaces/records';

/** The refusal message when an opening init finds an attempt already waiting. */
export const RECOVERY_CLIENT_ATTEMPT_WAITING_MESSAGE = 'an attempt is already waiting for this account and action';

/** The refusal message when a cancel init finds no attempt waiting. */
export const RECOVERY_CLIENT_NO_ATTEMPT_WAITING_MESSAGE = 'no attempt is waiting for this account and action';

/** The refusal message when the handover would not pass the action's own checks, or its removed key cannot be named. */
export const RECOVERY_CLIENT_HANDOVER_REFUSED_MESSAGE = 'the handover would not pass the action';

/** The rejection message when a rule method's stop or trusted-parties read went unanswered. */
export const RECOVERY_CLIENT_UNANSWERED_READ_MESSAGE = 'a rule method read went unanswered';

/** What `eth_getCode` answers for an address that holds no code. */
export const RECOVERY_CLIENT_NO_CODE: Hex = '0x';
