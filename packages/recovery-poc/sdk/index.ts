// SPDX-License-Identifier: MIT
/**
 * @file index.ts
 * @module @kohaku-eth/recovery (PoC mirror)
 *
 * Public barrel for the recovery-adapter PoC SDK glue. Re-exports the calldata
 * builders, the off-chain `recoveryHash` computation, the ABI fragments, and the
 * optional runtime `RecoveryClient`.
 */

export {
  // types
  type Call,
  type RecoveryConfig,
  type RecoveryHashScheme,
  // (a) authorize adapter [owner-signed, once]
  buildSetAdapterPrivilegeCall,
  buildAuthorizeAdapterCall,
  // (b) initiate recovery [owner-free]
  buildInitiateRecoveryCall,
  buildRotateSignerCall,
  // (c) off-chain recoveryHash
  computeRecoveryHash,
  // shared encoders + constants
  encodeExecuteBySender,
  encodeInitiateRecovery,
  AMBIRE_ACCOUNT_ABI,
  RECOVERY_CONTROLLER_ABI,
  PRIV_AUTHORIZED,
  PRIV_NONE,
  // optional runtime wiring
  RecoveryClient,
} from './recoveryAdapterClient.js';

// --- recovery v0 (real ERC-7579) mirror ---
export {
  // constants
  MODE_SINGLE_DEFAULT,
  ROTATE_OWNER_SELECTOR,
  PRIV_AUTHORIZED_V0,
  // ABI fragments
  RECOVERY_CONTROLLER_V0_ABI,
  IERC7579_ACCOUNT_ABI,
  MINIMAL_ACCOUNT_ABI,
  // ERC-7579 single-call encoding
  encodeSingleExecution,
  encodeRotateOwnerCall,
  // controller entrypoint + inspection helpers
  encodeInitiateRecoveryV0,
  buildExecuteFromExecutorArgs,
} from './recoveryV0Client.js';
