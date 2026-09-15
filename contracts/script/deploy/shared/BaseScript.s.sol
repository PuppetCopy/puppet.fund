// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Script} from "forge-std/src/Script.sol";
import {VmSafe} from "forge-std/src/Vm.sol";
import {stdToml} from "forge-std/src/StdToml.sol";

import {NATIVE_TOKEN} from "src/utils/Native.sol";

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
    string constant CONST_PATH = "./const.toml";

    bool internal _universe;
    mapping(bytes32 name => address) internal _plannedAddr;

    function _isDryRun() internal view returns (bool) {
        return vm.isContext(VmSafe.ForgeContext.ScriptDryRun);
    }

    function _resetBroadcastForUniverse() internal {
        if (!_universe || _isDryRun()) return;
        string memory _chainDir = string.concat("./broadcast/Deploy.s.sol/", vm.toString(block.chainid));
        if (vm.exists(_chainDir)) vm.removeDir(_chainDir, true);
        vm.createDir(_chainDir, true);
    }

    function _deployerKey() internal view returns (uint) {
        return vm.envUint("DEPLOYER_PRIVATE_KEY");
    }

    address internal immutable RELAYER_ADDRESS = vm.envAddress("RELAYER_ADDRESS");
    address internal immutable GOVERNOR_ADDRESS = vm.envAddress("GOVERNOR_ADDRESS");

    string internal _const = vm.readFile(CONST_PATH);

    function _attestorAddress() internal view returns (address) {
        return _const.readAddress(".PROTOCOL.attestor");
    }

    function _getChainToken(
        string memory symbol
    ) internal view returns (IERC20) {
        address addr = _const.readAddress(string.concat(".TOKEN_ADDRESS.", _chainKey(), ".", symbol, ".address"));
        require(addr != address(0), string.concat("Chain token not found: ", symbol));
        require(addr == NATIVE_TOKEN || addr.code.length > 0, string.concat("Chain token not deployed: ", symbol));
        return IERC20(addr);
    }

    function _getChainTokenCap(
        string memory symbol
    ) internal view returns (uint) {
        return _const.readUint(string.concat(".TOKEN_ADDRESS.", _chainKey(), ".", symbol, ".cap"));
    }

    function _getVersion() internal view returns (uint) {
        return _const.readUint(".PROTOCOL.version");
    }

    function _getHubChainId() internal view returns (uint) {
        return _const.readUint(".PROTOCOL.hubChainId");
    }

    function _wntSymbol() internal view returns (string memory) {
        string memory key = string.concat(".CHAIN_META.", _chainKey(), ".wnt");
        require(vm.keyExistsToml(_const, key), string.concat("const: CHAIN_META.wnt not set for ", _chainKey()));
        return _const.readString(key);
    }

    function _chainImpl() internal view returns (string memory) {
        string memory key = string.concat(".CHAIN_META.", _chainKey(), ".chain");
        require(vm.keyExistsToml(_const, key), string.concat("const: CHAIN_META.chain not set for ", _chainKey()));
        return _const.readString(key);
    }

    function _getMaxRelayFeeBps() internal view returns (uint) {
        return _const.readUint(".PROTOCOL.maxRelayFeeBps");
    }

    function _getTransferGasLimit() internal view returns (uint) {
        return _const.readUint(".PROTOCOL.transferGasLimit");
    }

    function _specAddr(
        string memory name
    ) internal view returns (address) {
        address planned = _plannedAddr[keccak256(bytes(name))];
        if (planned != address(0)) return planned;
        string memory fresh = vm.readFile(DEPLOYMENTS_PATH);
        string memory chainKey = string.concat(".chain.", _chainKey(), ".", name);
        if (vm.keyExistsToml(fresh, chainKey)) return fresh.readAddress(chainKey);
        revert(string.concat("Spec address not found: ", name));
    }

    function _setChainAddress(
        string memory name,
        address addr
    ) internal {
        if (_isDryRun()) return;
        vm.writeToml(vm.toString(addr), DEPLOYMENTS_PATH, string.concat(".chain.", _chainKey(), ".", name));
    }

    function _chainKey() internal view returns (string memory) {
        string[] memory names = vm.parseTomlKeys(_const, ".CHAIN_META");
        for (uint i; i < names.length; ++i) {
            if (_const.readUint(string.concat(".CHAIN_META.", names[i], ".id")) == block.chainid) return names[i];
        }
        revert(string.concat("Unknown chain id: ", vm.toString(block.chainid)));
    }
}
