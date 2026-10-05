import type { ActionInfo, Address, PinnedBlock, PreparedCall } from './records';

/** One recovery action contract's reads and its disarming write, bound to one account; each reads or pins at `block` where one is passed. */
export interface IRecoveryActionInteractor {
  supportsAccount(block?: PinnedBlock): Promise<boolean>;
  isAuthority(key: Address, block?: PinnedBlock): Promise<boolean>;
  isAuthorized(block?: PinnedBlock): Promise<boolean>;
  holdsAnyPrivilege(candidate: Address, block?: PinnedBlock): Promise<boolean>;
  actionInfo(block?: PinnedBlock): Promise<ActionInfo>;
  /** The account's privilege write taking the action's authorization back, pinned at `block` where one is passed. */
  disarmingCall(block?: PinnedBlock): Promise<PreparedCall>;
}
