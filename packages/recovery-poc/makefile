CORES := $(shell nproc)
install:
	foundryup
	# forge-std is the only Solidity dependency, installed via `forge install`
	# (not a git submodule) so a fresh checkout provisions it without needing the
	# dep registered in the repo-root .gitmodules.
	forge install foundry-rs/forge-std
test:
	forge test -j$(CORES) -vvv
test_lite:
	FOUNDRY_PROFILE=lite forge test -j$(CORES) -vvv
# Deploy + wire the recovery v0 demo on local anvil (chainId 31337) and write
# deployments/anvil-v0.json. Starts anvil if not already running. Pass
# EXTENSION_DIR=<path> to also copy the manifest into the extension screen dir.
deploy-v0:
	bash script/deploy-v0.sh
