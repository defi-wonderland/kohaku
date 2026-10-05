import type { PinnedBlock, PreparedCall } from './records';

/** Arms the recovery action on the account. */
export interface IRecoveryActionArming {
  /** The account's own write authorizing the action, pinned at `block` where one is passed. */
  armingCall(block?: PinnedBlock): Promise<PreparedCall>;
}
