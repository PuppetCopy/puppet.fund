// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Script} from "forge-std/src/Script.sol";
import {stdToml} from "forge-std/src/StdToml.sol";

interface ImmutableCreate2Factory {
    function safeCreate2(
        bytes32 salt,
        bytes calldata initializationCode
    ) external payable returns (address deploymentAddress);

    function findCreate2Address(
        bytes32 salt,
        bytes calldata initializationCode
    ) external view returns (address deploymentAddress);
}

abstract contract BaseScript is Script {
    using stdToml for string;

    ImmutableCreate2Factory constant FACTORY = ImmutableCreate2Factory(0x0000000000FFe8B47B3e2130213B802212439497);

    string constant DEPLOYMENTS_PATH = "./deployments.toml";
    string constant CONST_PATH = "./const.toml";

    uint internal immutable DEPLOYER_PRIVATE_KEY = vm.envUint("DEPLOYER_PRIVATE_KEY");
    address internal immutable DEPLOYER_ADDRESS = vm.addr(DEPLOYER_PRIVATE_KEY);
    address internal immutable ATTESTOR_ADDRESS = vm.envAddress("ATTESTOR_ADDRESS");
    address internal immutable RELAYER_ADDRESS = vm.envAddress("RELAYER_ADDRESS");
    address internal immutable GOVERNOR_ADDRESS = vm.envAddress("GOVERNOR_ADDRESS");

    string internal _deployments = vm.readFile(DEPLOYMENTS_PATH);
    string internal _const = vm.readFile(CONST_PATH);

    function _getChainToken(
        string memory symbol
    ) internal view returns (IERC20) {
        address addr = _const.readAddress(string.concat(".", _chainKey(), ".token.", symbol));
        require(addr != address(0), string.concat("Chain token not found: ", symbol));
        require(addr.code.length > 0, string.concat("Chain token not deployed: ", symbol));
        return IERC20(addr);
    }

    function _getOifInputSettler() internal view returns (address) {
        address addr = _const.readAddress(".oif.inputSettler");
        require(addr != address(0), "OIF inputSettler not configured");
        return addr;
    }

    function _getOifOutputSettler() internal view returns (bytes32) {
        address addr = _const.readAddress(".oif.outputSettler");
        require(addr != address(0), "OIF outputSettler not configured");
        return bytes32(uint(uint160(addr)));
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
    ) internal view returns (address addr) {
        addr = _deployments.readAddress(string.concat(".core.", name, ".address"));
        require(addr != address(0), string.concat("Core address not found: ", name));
        require(addr.code.length > 0, string.concat("Core contract not deployed: ", name));
        require(_isCoreDeployedOnCurrentChain(name), string.concat("Core contract not deployed on this chain: ", name));
    }

    function _getChainAddress(
        string memory name
    ) internal view returns (address addr) {
        addr = _deployments.readAddress(string.concat(".chain.", _chainKey(), ".", name));
        require(addr != address(0), string.concat("Chain address not found: ", name));
        require(addr.code.length > 0, string.concat("Chain contract not deployed: ", name));
    }

    function _setCoreAddress(
        string memory name,
        address addr,
        bool enforceDrift
    ) internal {
        string memory addrKey = string.concat(".core.", name, ".address");
        string memory fresh = vm.readFile(DEPLOYMENTS_PATH);
        if (enforceDrift && vm.keyExistsToml(fresh, addrKey)) {
            address prior = fresh.readAddress(addrKey);
            if (prior != address(0) && prior != addr && !vm.envOr("ALLOW_CORE_DRIFT", false)) {
                revert(string.concat("Core address drift: ", name, " deployed at different address on another chain"));
            }
        }
        vm.writeToml(vm.toString(addr), DEPLOYMENTS_PATH, addrKey);
        _recordCoreChain(name);
    }

    function _specAddr(
        string memory name
    ) internal view returns (address) {
        string memory fresh = vm.readFile(DEPLOYMENTS_PATH);
        string memory coreKey = string.concat(".core.", name, ".address");
        if (vm.keyExistsToml(fresh, coreKey)) {
            address a = fresh.readAddress(coreKey);
            if (a != address(0)) return a;
        }
        string memory chainKey = string.concat(".chain.", _chainKey(), ".", name);
        if (vm.keyExistsToml(fresh, chainKey)) return fresh.readAddress(chainKey);
        revert(string.concat("Spec address not found: ", name));
    }

    function _create(
        bytes memory initCode
    ) internal returns (address addr) {
        assembly ("memory-safe") {
            addr := create(0, add(initCode, 0x20), mload(initCode))
        }
        require(addr != address(0), "CREATE failed");
    }

    function _setCoreBytes32(
        string memory name,
        string memory field,
        bytes32 value
    ) internal {
        string memory key = string.concat(".core.", name, ".", field);
        string memory fresh = vm.readFile(DEPLOYMENTS_PATH);
        if (vm.keyExistsToml(fresh, key)) {
            bytes32 prior = fresh.readBytes32(key);
            require(
                prior == value,
                string.concat("Core ", field, " drift: ", name, " differs from previously recorded value")
            );
        }
        vm.writeToml(vm.toString(value), DEPLOYMENTS_PATH, key);
    }

    function _setChainAddress(
        string memory name,
        address addr
    ) internal {
        vm.writeToml(vm.toString(addr), DEPLOYMENTS_PATH, string.concat(".chain.", _chainKey(), ".", name));
    }

    function _l2BlockNumber() internal returns (uint) {
        // Foundry sets `block.number` on Arbitrum to the L1 block, and the
        // ArbSys precompile (0x64) isn't simulated. Query the live RPC for
        // the actual L2 block instead. vm.rpc returns the ABI-decoded result
        // as variable-length bytes; left-align into a uint.
        bytes memory raw = vm.rpc("eth_blockNumber", "[]");
        return uint(bytes32(raw)) >> (8 * (32 - raw.length));
    }

    function _recordCoreChain(
        string memory name
    ) internal {
        string memory chainBlockMapKey = string.concat(".core.", name, ".chainBlockMap");
        string memory chainIdStr = vm.toString(block.chainid);
        uint blockNum = _l2BlockNumber();
        string memory fresh = vm.readFile(DEPLOYMENTS_PATH);

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
        vm.writeToml(json, DEPLOYMENTS_PATH, chainBlockMapKey);
    }

    function _isCoreDeployedOnCurrentChain(
        string memory name
    ) internal view returns (bool) {
        string memory key = string.concat(".core.", name, ".chainBlockMap.", vm.toString(block.chainid));
        return vm.keyExistsToml(_deployments, key);
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
