import type { RequestWindowBounds } from '@kohaku-eth/social-recovery';

/** The chain id the Node scripts put in the sample request; the page uses the wallet's own instead. */
export const SAMPLE_CHAIN_ID = 31337;

/** Labels the sample's local addresses are derived from; none of them is deployed anywhere. */
export const SAMPLE_LABELS = {
  account: 'playground account',
  manager: 'playground policy manager',
  action: 'playground recovery action',
  method: 'playground wallet method',
  newAuthority: 'playground new key',
  removedAuthority: 'playground lost key',
  blockHash: 'playground pinned block',
} as const;

/** The setup's wait before a recovery can be consumed, in seconds. */
export const SAMPLE_WAIT = 3 * 24 * 60 * 60;

/** How long the approver requests stay valid past the pinned block, in seconds. */
export const SAMPLE_WINDOW = 24 * 60 * 60;

/** The pinned block's number in the sample record. */
export const SAMPLE_BLOCK_NUMBER = 1;

/** The attempt the sample gathering collects approvals for, and the setup nonce it was made under. */
export const SAMPLE_ATTEMPT_ID = '1';

export const SAMPLE_SETUP_NONCE = '0';

/** How many approvals the sample's one clause needs. */
export const SAMPLE_THRESHOLD = 2;

/** The request window bounds `count` judges the record's window against, in seconds. */
export const SAMPLE_WINDOW_BOUNDS: RequestWindowBounds = { default: SAMPLE_WINDOW, floor: 60 * 60 };

/** The zero address, the sample order's token and payee, which leaves the order open. */
export const SAMPLE_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** The sample order's amount, as the record's decimal string: the account pays nothing. */
export const SAMPLE_ORDER_AMOUNT = '0';
