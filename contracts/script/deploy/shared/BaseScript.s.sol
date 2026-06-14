// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Script} from "forge-std/src/Script.sol";
import {VmSafe} from "forge-std/src/Vm.sol";
import {stdToml} from "forge-std/src/StdToml.sol";

interface ImmutableCreate2Factory {
    function safeCreate2(
        bytes32 salt,
        bytes calldata initializationCode
    ) external payable returns (address deploymentAddress);
}

abstract contract BaseScript is Script {
    using stdToml for string;

    ImmutableCreate2Factory constant FACTORY = ImmutableCreate2Factory(0x0000000000FFe8B47B3e2130213B802212439497);

    string constant DEPLOYMENTS_PATH = "./deployments.toml";
    string constant DEPLOYMENTS_SCRATCH_PATH = "./deployments.local.toml";
    string constant CONST_PATH = "./const.toml";

    bool private _scratchReady;
    mapping(bytes32 name => address) internal _plannedAddr;

    // Dry-runs execute vm.writeToml like real runs do, so without isolation every
    // simulation poisons deployments.toml with phantom addresses that only a
    // following broadcast would correct. Route all toml IO through a scratch copy
    // unless this process is actually broadcasting.
    function _deploymentsPath() internal returns (string memory) {
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            return DEPLOYMENTS_PATH;
        }
        if (!_scratchReady) {
            vm.copyFile(DEPLOYMENTS_PATH, DEPLOYMENTS_SCRATCH_PATH);
            _scratchReady = true;
        }
        return DEPLOYMENTS_SCRATCH_PATH;
    }

    uint internal immutable DEPLOYER_PRIVATE_KEY = vm.envUint("DEPLOYER_PRIVATE_KEY");
    address internal immutable DEPLOYER_ADDRESS = vm.addr(DEPLOYER_PRIVATE_KEY);
    address internal immutable ATTESTOR_ADDRESS = vm.envAddress("ATTESTOR_ADDRESS");
    address internal immutable RELAYER_ADDRESS = vm.envAddress("RELAYER_ADDRESS");
    address internal immutable GOVERNOR_ADDRESS = vm.envAddress("GOVERNOR_ADDRESS");

    string internal _const = vm.readFile(CONST_PATH);

    function _getChainToken(
        string memory symbol
    ) internal view returns (IERC20) {
        address addr = _const.readAddress(string.concat(".", _chainKey(), ".token.", symbol));
        require(addr != address(0), string.concat("Chain token not found: ", symbol));
        require(addr.code.length > 0, string.concat("Chain token not deployed: ", symbol));
        return IERC20(addr);
    }

    function _getVersion() internal view returns (uint) {
        return _const.readUint(".protocol.version");
    }

    function _getHubChainId() internal view returns (uint) {
        return _const.readUint(".protocol.hubChainId");
    }

    function _getMaxBlockDelay() internal view returns (uint) {
        return _const.readUint(".protocol.maxBlockDelay");
    }

    function _getMaxRelayFeeBps() internal view returns (uint) {
        return _const.readUint(".protocol.maxRelayFeeBps");
    }

    function _getTransferGasLimit() internal view returns (uint) {
        return _const.readUint(".protocol.transferGasLimit");
    }

    function _getCoreAddress(
        string memory name
    ) internal returns (address addr) {
        addr = vm.readFile(_deploymentsPath()).readAddress(string.concat(".core.", name, ".address"));
        require(addr != address(0), string.concat("Core address not found: ", name));
        require(addr.code.length > 0, string.concat("Core contract not deployed: ", name));
        require(_isCoreDeployedOnCurrentChain(name), string.concat("Core contract not deployed on this chain: ", name));
    }

    function _setCoreAddress(
        string memory name,
        address addr,
        bool deployedNow
    ) internal {
        vm.writeToml(vm.toString(addr), _deploymentsPath(), string.concat(".core.", name, ".address"));
        _recordCoreChain(name, deployedNow);
    }

    function _specAddr(
        string memory name
    ) internal returns (address) {
        address planned = _plannedAddr[keccak256(bytes(name))];
        if (planned != address(0)) return planned;
        string memory fresh = vm.readFile(_deploymentsPath());
        string memory coreKey = string.concat(".core.", name, ".address");
        if (vm.keyExistsToml(fresh, coreKey)) {
            address a = fresh.readAddress(coreKey);
            if (a != address(0)) return a;
        }
        string memory chainKey = string.concat(".chain.", _chainKey(), ".", name);
        if (vm.keyExistsToml(fresh, chainKey)) return fresh.readAddress(chainKey);
        revert(string.concat("Spec address not found: ", name));
    }

    function _setChainAddress(
        string memory name,
        address addr
    ) internal {
        vm.writeToml(vm.toString(addr), _deploymentsPath(), string.concat(".chain.", _chainKey(), ".", name));
    }

    function _l2BlockNumber() internal returns (uint) {
        // Foundry sets `block.number` on Arbitrum to the L1 block, and the
        // ArbSys precompile (0x64) isn't simulated. Prefer an env-provided
        // snapshot (L2_BLOCK_NUMBER, fetched via `cast block-number` right
        // before the run) — vm.rpc mid-script rides a connection that has
        // gone stale during the long local simulation. Fall back to a live
        // query; vm.rpc returns the ABI-decoded result as variable-length
        // bytes; left-align into a uint.
        uint hint = vm.envOr("L2_BLOCK_NUMBER", uint(0));
        if (hint != 0) return hint;
        bytes memory raw = vm.rpc("eth_blockNumber", "[]");
        return uint(bytes32(raw)) >> (8 * (32 - raw.length));
    }

    function _recordCoreChain(
        string memory name,
        bool deployedNow
    ) internal {
        string memory chainBlockMapKey = string.concat(".core.", name, ".chainBlockMap");
        string memory chainIdStr = vm.toString(block.chainid);
        string memory fresh = vm.readFile(_deploymentsPath());
        if (!deployedNow && vm.keyExistsToml(fresh, string.concat(chainBlockMapKey, ".", chainIdStr))) return;
        uint blockNum = _l2BlockNumber();

        string memory json = "{";
        bool first = true;
        if (vm.keyExistsToml(fresh, chainBlockMapKey)) {
            string[] memory keys = vm.parseTomlKeys(fresh, chainBlockMapKey);
            for (uint i; i < keys.length; ++i) {
                if (keccak256(bytes(keys[i])) == keccak256(bytes(chainIdStr))) continue;
                uint existingBlock = fresh.readUint(string.concat(chainBlockMapKey, ".", keys[i]));
                if (!first) json = string.concat(json, ",");
                json = string.concat(json, '"', keys[i], '":', vm.toString(existingBlock));
                first = false;
            }
        }
        if (!first) json = string.concat(json, ",");
        json = string.concat(json, '"', chainIdStr, '":', vm.toString(blockNum), "}");
        vm.writeToml(json, _deploymentsPath(), chainBlockMapKey);
    }

    function _isCoreDeployedOnCurrentChain(
        string memory name
    ) internal returns (bool) {
        string memory key = string.concat(".core.", name, ".chainBlockMap.", vm.toString(block.chainid));
        return vm.keyExistsToml(vm.readFile(_deploymentsPath()), key);
    }

    function _chainKey() internal view returns (string memory) {
        return _chainKeyOf(block.chainid);
    }

    function _hubChainKey() internal view returns (string memory) {
        return _chainKeyOf(_getHubChainId());
    }

    function _chainKeyOf(
        uint chainId
    ) internal pure returns (string memory) {
        if (chainId == 42_161) return "arbitrum";
        if (chainId == 10) return "optimism";
        if (chainId == 8453) return "base";
        if (chainId == 1) return "mainnet";
        if (chainId == 11_155_111) return "sepolia";
        revert(string.concat("Unknown chain id: ", vm.toString(chainId)));
    }
}
