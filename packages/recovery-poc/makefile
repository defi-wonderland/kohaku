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
