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
