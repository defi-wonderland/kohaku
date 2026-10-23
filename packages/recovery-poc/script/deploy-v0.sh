#!/usr/bin/env bash
#
# deploy-v0.sh — one-shot local deploy + wiring of the Kohaku recovery v0 demo.
#
# What it does:
#   1. Ensures an anvil node (chainId 31337) is running on 127.0.0.1:8545; starts one
#      in the background if not.
#   2. Runs script/DeployV0.s.sol with env-driven config (NO hardcoded addresses in the
#      contracts). Deploys + wires BOTH targets (native Minimal7579Account + Ambire) and
#      writes deployments/anvil-v0.json.
#   3. Optionally copies the manifest into the extension's RecoverySettingsScreen so the
#      GUI can load it directly.
#
# Anvil's deterministic accounts (mnemonic "test test ... junk"):
#   key #0  0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
#           -> 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266   (deployer + DEMO_OWNER + relayer)
#   acct #1 0x70997970C51812dc3A010C7d01b50e0d17dc79C8       (NEW_OWNER hint / rotation target)
#   acct #2 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC       (alternate rotation target)
#
# The deploy script REQUIRES deployer == DEMO_OWNER (the Ambire onboarding step is an
# owner self-call), so DEMO_OWNER is anvil account #0 by default.
#
# Env overrides (all optional):
#   RPC_URL        default http://127.0.0.1:8545
#   PRIVATE_KEY    default anvil key #0
#   DEMO_OWNER     default anvil account #0 (MUST match PRIVATE_KEY's address)
#   NEW_OWNER      default anvil account #1 (UI rotation-target hint)
#   EXTENSION_DIR  if set, copies the manifest into the extension screen dir
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PKG_DIR}"

RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
PRIVATE_KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
DEMO_OWNER="${DEMO_OWNER:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"
NEW_OWNER="${NEW_OWNER:-0x70997970C51812dc3A010C7d01b50e0d17dc79C8}"

ANVIL_PID=""
cleanup() {
  # Only stop anvil if WE started it.
  if [[ -n "${ANVIL_PID}" ]]; then
    echo "[deploy-v0] stopping anvil (pid ${ANVIL_PID})"
    kill "${ANVIL_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# 1) Ensure anvil is up.
if cast block-number --rpc-url "${RPC_URL}" >/dev/null 2>&1; then
  echo "[deploy-v0] anvil already running at ${RPC_URL}"
else
  echo "[deploy-v0] starting anvil (chain-id 31337) in the background..."
  anvil --chain-id 31337 >/tmp/kohaku-anvil-v0.log 2>&1 &
  ANVIL_PID=$!
  # Wait for it to accept connections.
  for _ in $(seq 1 50); do
    if cast block-number --rpc-url "${RPC_URL}" >/dev/null 2>&1; then break; fi
    sleep 0.2
  done
  cast block-number --rpc-url "${RPC_URL}" >/dev/null 2>&1 || {
    echo "[deploy-v0] ERROR: anvil did not come up; see /tmp/kohaku-anvil-v0.log" >&2
    exit 1
  }
  echo "[deploy-v0] anvil up (pid ${ANVIL_PID})"
fi

# 2) Deploy + wire everything.
echo "[deploy-v0] deploying recovery v0 (native + ambire)..."
PRIVATE_KEY="${PRIVATE_KEY}" DEMO_OWNER="${DEMO_OWNER}" NEW_OWNER="${NEW_OWNER}" \
  forge script script/DeployV0.s.sol:DeployV0 \
    --rpc-url "${RPC_URL}" \
    --broadcast \
    -vv

MANIFEST="${PKG_DIR}/deployments/anvil-v0.json"
if [[ -f "${MANIFEST}" ]]; then
  echo "[deploy-v0] manifest written:"
  cat "${MANIFEST}"
  echo
else
  echo "[deploy-v0] ERROR: expected manifest at ${MANIFEST} was not produced" >&2
  exit 1
fi

# 3) Optionally copy the manifest into the extension screen dir.
if [[ -n "${EXTENSION_DIR:-}" ]]; then
  DEST_DIR="${EXTENSION_DIR}/src/web/modules/settings/screens/RecoverySettingsScreen"
  if [[ -d "${DEST_DIR}" ]]; then
    cp "${MANIFEST}" "${DEST_DIR}/anvil-v0.json"
    echo "[deploy-v0] copied manifest -> ${DEST_DIR}/anvil-v0.json"
  else
    echo "[deploy-v0] NOTE: EXTENSION_DIR set but ${DEST_DIR} not found; skipped copy" >&2
  fi
fi

# If we started anvil, keep it running so the demo can use it. Detach from the trap.
if [[ -n "${ANVIL_PID}" ]]; then
  echo "[deploy-v0] anvil left running (pid ${ANVIL_PID}); logs at /tmp/kohaku-anvil-v0.log"
  echo "[deploy-v0] stop it with: kill ${ANVIL_PID}"
  trap - EXIT
fi

echo "[deploy-v0] done."
