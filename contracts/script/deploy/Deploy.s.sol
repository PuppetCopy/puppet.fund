// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {GateConfig} from "src/utils/GateConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vm} from "forge-std/src/Vm.sol";
import {console2} from "forge-std/src/console2.sol";
import {stdToml} from "forge-std/src/StdToml.sol";

import {BaseScript} from "./shared/BaseScript.s.sol";

import {Dictate} from "src/core/Dictate.sol";
import {Register} from "src/core/Register.sol";
import {Chain as ChainProxy} from "src/core/Chain.sol";
import {Access} from "src/utils/auth/Access.sol";

contract Deploy is BaseScript {
    using stdToml for string;

    function _requireDeployConfig() internal view {
        require(
            keccak256(bytes(vm.envOr("FOUNDRY_PROFILE", string("")))) == keccak256("prod"),
            "Deploy: FOUNDRY_PROFILE must be prod; forge-artifacts-prod persists on disk so a default-profile run silently ships stale bytecode"
        );
        require(_attestorAddress() != address(0), "Deploy: const.toml [PROTOCOL].attestor is zero");
        require(RELAYER_ADDRESS != address(0), "Deploy: RELAYER_ADDRESS is zero");
        uint _baseFeeCap = vm.envOr("MAX_BASE_FEE_WEI", uint(0));
        if (_baseFeeCap != 0) {
            require(
                block.basefee <= _baseFeeCap,
                string.concat(
                    "Deploy: base fee ",
                    vm.toString(block.basefee),
                    " wei exceeds cap ",
                    vm.toString(_baseFeeCap),
                    " wei (override with MAX_BASE_FEE_WEI)"
                )
            );
        }
    }

    function deploy() public {
        _requireDeployConfig();
        bool isHub = block.chainid == _getHubChainId();
        _universe = _isUniverseMigration(_getVersion());

        _planAndGate(isHub);
        bool changed;
        for (uint i; i < _plan.length; ++i) {
            if (_plan[i].deployNeeded || _plan[i].prev != _plan[i].predicted) {
                changed = true;
                break;
            }
        }
        if (!changed) {
            console2.log("plan all-keep; nothing to broadcast (use wire() to re-assert wiring)");
            return;
        }
        _resetBroadcastForUniverse();
        vm.startBroadcast(_deployerKey());
        _executePlan();
        _wireGate(isHub);
        _registerTokens();
        vm.stopBroadcast();
    }

    function wire() public {
        _requireDeployConfig();
        bool isHub = block.chainid == _getHubChainId();
        _universe = _isUniverseMigration(_getVersion());
        _planAndGate(isHub);
        for (uint i; i < _plan.length; ++i) {
            require(!_plan[i].deployNeeded, string.concat("Deploy: not deployed, run deploy(): ", _plan[i].name));
        }
        vm.startBroadcast(_deployerKey());
        _wireGate(isHub);
        _registerTokens();
        vm.stopBroadcast();
    }

    function _planAndGate(
        bool isHub
    ) internal {
        string[] memory core = _coreContracts();
        string[] memory stores = _storeNames(isHub);
        string[] memory names = new string[](core.length + stores.length + 1);
        for (uint i; i < core.length; ++i) {
            names[i] = core[i];
        }
        for (uint i; i < stores.length; ++i) {
            names[core.length + i] = stores[i];
        }
        names[core.length + stores.length] = _gateName(isHub);
        uint version = _getVersion();
        string memory storeAck = vm.envOr("MIGRATE_STORES", string(""));
        bytes32 salt = bytes32(version);
        bool refused;
        string memory hubRecord = "";
        if (!isHub) {
            string[] memory metaKeys = vm.parseTomlKeys(_const, ".CHAIN_META");
            for (uint i; i < metaKeys.length; ++i) {
                if (_const.readUint(string.concat(".CHAIN_META.", metaKeys[i], ".id")) == _getHubChainId()) {
                    hubRecord = string.concat(".chain.", metaKeys[i], ".");
                }
            }
        }
        string memory deployed = vm.readFile(DEPLOYMENTS_PATH);
        console2.log("=== deploy plan | version:", version, _universe ? "| UNIVERSE MIGRATION" : "");
        require(
            !_universe || vm.envOr("ALLOW_UNIVERSE_MIGRATION", false),
            "Deploy: this re-keys every root and store and orphans the live universe; set ALLOW_UNIVERSE_MIGRATION=true"
        );
        for (uint i; i < names.length; ++i) {
            Meta memory m = _meta(names[i]);
            bytes32 initCodeHash = keccak256(bytes.concat(m.creationCode, m.ctorArgs));
            address predicted =
                address(uint160(uint(keccak256(abi.encodePacked(bytes1(0xff), address(FACTORY), salt, initCodeHash)))));
            _plannedAddr[keccak256(bytes(names[i]))] = predicted;
            address prev = _addrOrZero(_isRouter(names[i]) ? string.concat(names[i], "Impl") : names[i]);
            bool deployNeeded = predicted.code.length == 0;
            bool drift = prev != address(0) && prev != predicted;
            _plan.push(Plan({name: names[i], predicted: predicted, prev: prev, deployNeeded: deployNeeded}));
            console2.log(
                string.concat(
                    _classLabel(m.class), drift ? " drift " : (deployNeeded ? " new   " : " keep  "), names[i]
                ),
                predicted
            );
            if (
                !isHub && m.class != Class.Logic
                    && (
                        !vm.keyExistsToml(deployed, string.concat(hubRecord, names[i]))
                            || deployed.readAddress(string.concat(hubRecord, names[i])) != predicted
                    )
            ) {
                console2.log("    REFUSED: a shared root or store must sit at the hub's recorded address", names[i]);
                refused = true;
            }
            if (drift && !_universe) {
                if (m.class == Class.Root) {
                    console2.log("    REFUSED: root re-key orphans derived addresses; bump protocol.version");
                    refused = true;
                } else if (m.class == Class.Store && !_listContains(storeAck, names[i])) {
                    console2.log("    REFUSED: store re-key resets state; ack with MIGRATE_STORES");
                    refused = true;
                }
            }
        }
        require(!refused, "Deploy: plan refused");
    }

    function _isUniverseMigration(
        uint version
    ) internal view returns (bool) {
        Meta memory m = _meta("Dictate");
        address predicted = address(
            uint160(
                uint(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff),
                            address(FACTORY),
                            bytes32(version),
                            keccak256(bytes.concat(m.creationCode, m.ctorArgs))
                        )
                    )
                )
            )
        );
        address recorded = _addrOrZero("Dictate");
        return recorded == address(0) || recorded != predicted;
    }

    function _executePlan() internal {
        bytes32 salt = bytes32(_getVersion());
        for (uint i; i < _plan.length; ++i) {
            Plan memory p = _plan[i];
            if (p.deployNeeded) {
                Meta memory m = _meta(p.name);
                FACTORY.safeCreate2(salt, bytes.concat(m.creationCode, m.ctorArgs));
            }
            if (_isRouter(p.name)) continue;
            _setChainAddress(p.name, p.predicted);
        }
    }

    function _classLabel(
        Class c
    ) internal pure returns (string memory) {
        if (c == Class.Root) return "[root ]";
        if (c == Class.Store) return "[store]";
        return "[logic]";
    }

    function _listContains(
        string memory csv,
        string memory name
    ) internal pure returns (bool) {
        bytes memory h = bytes(csv);
        bytes memory n = bytes(name);
        if (n.length == 0 || h.length < n.length) return false;
        uint start;
        for (uint i; i <= h.length; ++i) {
            if (i < h.length && h[i] != "," && h[i] != " ") continue;
            if (i - start == n.length) {
                bool ok = true;
                for (uint j; j < n.length; ++j) {
                    if (h[start + j] != n[j]) {
                        ok = false;
                        break;
                    }
                }
                if (ok) return true;
            }
            start = i + 1;
        }
        return false;
    }

    function redeployGate(
        string memory name
    ) public {
        _requireDeployConfig();
        require(bytes(name).length <= 32, "Deploy: gate name exceeds bytes32");
        vm.startBroadcast(_deployerKey());
        Dictate dictate = Dictate(_specAddr("Dictate"));
        Meta memory m = _meta(name);
        bytes memory initCode = bytes.concat(m.creationCode, m.ctorArgs);
        bytes32 salt = bytes32(_getVersion());
        address impl = address(
            uint160(uint(keccak256(abi.encodePacked(bytes1(0xff), address(FACTORY), salt, keccak256(initCode)))))
        );
        if (impl.code.length == 0) FACTORY.safeCreate2(salt, initCode);
        bytes32 nameB;
        assembly {
            nameB := mload(add(name, 32))
        }
        address proxy = dictate.setGate(nameB, impl);
        _setChainAddress(string.concat(name, "Impl"), impl);
        _setChainAddress(name, proxy);
        vm.stopBroadcast();
    }

    function registerTokens() public {
        _requireDeployConfig();
        vm.startBroadcast(_deployerKey());
        _registerTokens();
        vm.stopBroadcast();
    }

    function _registerTokens() internal {
        Dictate dictate = Dictate(_specAddr("Dictate"));
        Register register = Register(_specAddr("Register"));
        string[] memory symbols = vm.parseTomlKeys(_const, string.concat(".TOKEN_ADDRESS.", _chainKey()));
        dictate.setAccess(register, vm.addr(_deployerKey()));
        for (uint i; i < symbols.length; ++i) {
            register.setRegistered(
                address(_getChainToken(symbols[i])),
                _getChainTokenCap(symbols[i]) == 0 ? bytes32(0) : bytes32(bytes(symbols[i]))
            );
        }
        dictate.removeAccess(register, vm.addr(_deployerKey()));
    }

    function setRegistered(
        string calldata symbol
    ) public {
        _requireDeployConfig();
        Dictate dictate = Dictate(_specAddr("Dictate"));
        Register register = Register(_specAddr("Register"));
        IERC20 token = _getChainToken(symbol);
        bytes32 tokenId = _getChainTokenCap(symbol) == 0 ? bytes32(0) : bytes32(bytes(symbol));
        vm.startBroadcast(_deployerKey());
        dictate.setAccess(register, vm.addr(_deployerKey()));
        register.setRegistered(address(token), tokenId);
        dictate.removeAccess(register, vm.addr(_deployerKey()));
        vm.stopBroadcast();
    }

    function verify() public {
        string[] memory core = _coreContracts();
        for (uint i; i < core.length; ++i) {
            _verify(core[i]);
        }
        bool isHub = block.chainid == _getHubChainId();
        string[] memory stores = _storeNames(isHub);
        for (uint i; i < stores.length; ++i) {
            _verify(stores[i]);
        }
        _verify(_gateName(isHub));
    }

    function verify(
        string memory name
    ) public {
        _verify(name);
    }

    function _coreContracts() internal pure returns (string[] memory names) {
        names = new string[](7);
        names[0] = "Dictate";
        names[1] = "Register";
        names[2] = "Chain";
        names[3] = "UserAccount";
        names[4] = "FundAccount";
        names[5] = "AccountModule";
        names[6] = "Deposit";
    }

    function _gateName(
        bool isHub
    ) internal pure returns (string memory) {
        return isHub ? "HubGate" : "SpokeGate";
    }

    function _gateKey(
        bool isHub
    ) internal pure returns (bytes32) {
        return isHub ? bytes32("HubGate") : bytes32("SpokeGate");
    }

    function _storeNames(
        bool isHub
    ) internal pure returns (string[] memory names) {
        if (!isHub) {
            names = new string[](1);
            names[0] = "EscrowStore";
            return names;
        }
        names = new string[](5);
        names[0] = "MandateStore";
        names[1] = "FundStore";
        names[2] = "EscrowStore";
        names[3] = "Share";
        names[4] = "Fund";
    }

    function _wireGate(
        bool isHub
    ) internal {
        Dictate dictate = Dictate(_specAddr("Dictate"));
        ChainProxy chain = ChainProxy(_specAddr("Chain"));
        if (chain.implementation() == address(0)) {
            bytes memory initCode = _creationCode(_chainImpl());
            bytes32 salt = bytes32(_getVersion());
            address impl = address(
                uint160(uint(keccak256(abi.encodePacked(bytes1(0xff), address(FACTORY), salt, keccak256(initCode)))))
            );
            if (impl.code.length == 0) FACTORY.safeCreate2(salt, initCode);
            dictate.setAccess(chain, vm.addr(_deployerKey()));
            chain.setImplementation(impl);
            dictate.removeAccess(chain, vm.addr(_deployerKey()));
            _setChainAddress("ChainImpl", impl);
        }
        address depositImpl = _specAddr("Deposit");
        address depositProxy = dictate.setGate(bytes32("Deposit"), depositImpl);
        require(depositProxy == _proxyAddr(bytes32("Deposit")), "Deploy: Deposit proxy address drift");
        string memory gate = _gateName(isHub);
        address gateImpl = _specAddr(gate);
        address gateProxy = dictate.setGate(_gateKey(isHub), gateImpl);

        dictate.setAccess(Access(_specAddr("AccountModule")), gateProxy);
        dictate.setAccess(Access(_specAddr("AccountModule")), depositProxy);
        dictate.setAccess(Access(depositProxy), gateProxy);
        dictate.setAccess(Access(_specAddr("EscrowStore")), gateProxy);
        if (isHub) {
            dictate.setAccess(Access(_specAddr("MandateStore")), gateProxy);
            address fundImpl = _specAddr("Fund");
            address fundProxy = dictate.setGate(bytes32("Fund"), fundImpl);
            require(fundProxy == _proxyAddr(bytes32("Fund")), "Deploy: Fund proxy address drift");
            dictate.setAccess(Access(_specAddr("AccountModule")), fundProxy);
            dictate.setAccess(Access(_specAddr("FundStore")), fundProxy);
            dictate.setAccess(Access(_specAddr("FundStore")), gateProxy);
            dictate.setAccess(Access(_specAddr("EscrowStore")), fundProxy);
            dictate.setAccess(Access(fundProxy), gateProxy);
            _setChainAddress("FundImpl", fundImpl);
            _setChainAddress("Fund", fundProxy);
        }

        _setChainAddress("DepositImpl", depositImpl);
        _setChainAddress("Deposit", depositProxy);
        _setChainAddress(string.concat(gate, "Impl"), gateImpl);
        _setChainAddress(gate, gateProxy);
    }

    function _getMaxCohortSize() internal view returns (uint) {
        return _const.readUint(".PROTOCOL.maxCohortSize");
    }

    function _gateConfig() internal view returns (GateConfig memory) {
        uint _withdrawDelay = _const.readUint(".PROTOCOL.withdrawDelay");
        require(
            _withdrawDelay == 0 || _withdrawDelay >= _const.readUint(".PROTOCOL.maxIntentTtlSec"),
            "Deploy: withdrawDelay must be zero or cover maxIntentTtlSec"
        );
        return GateConfig({
            attestor: _attestorAddress(),
            feeReceiver: RELAYER_ADDRESS,
            transferGasLimit: _getTransferGasLimit(),
            maxIntentTtl: _const.readUint(".PROTOCOL.maxIntentTtlSec"),
            maxRelayFeeBps: _getMaxRelayFeeBps()
        });
    }

    enum Class {
        Root,
        Store,
        Logic
    }

    struct Meta {
        bytes creationCode;
        bytes ctorArgs;
        Class class;
    }

    struct Plan {
        string name;
        address predicted;
        address prev;
        bool deployNeeded;
    }

    Plan[] internal _plan;

    function _isRouter(
        string memory name
    ) internal pure returns (bool) {
        bytes memory n = bytes(name);
        if (
            keccak256(n) == keccak256("Deposit") || keccak256(n) == keccak256("Fund")
        ) return true;
        return n.length >= 4 && n[n.length - 4] == "G" && n[n.length - 3] == "a" && n[n.length - 2] == "t"
            && n[n.length - 1] == "e";
    }

    function _proxyAddr(
        bytes32 key
    ) internal view returns (address) {
        address dictate = _specAddr("Dictate");
        bytes32 initCodeHash = keccak256(abi.encodePacked(_creationCode("RouterProxy"), abi.encode(dictate)));
        return address(uint160(uint(keccak256(abi.encodePacked(bytes1(0xff), dictate, key, initCodeHash)))));
    }

    // Load the PROD artifact by path, never type(X).creationCode and never a bare "File.sol:Name" qualifier: test/ and
    // script/ compile under the 1-run harness restriction, so every src contract also has a <Name>.harness.json and a
    // name qualifier resolves to it ambiguously. The explicit prod artifact path is the only unambiguous handle on the
    // 100k-run bytecode that must actually land on chain. Under a non-prod profile this file is absent and the deploy
    // fails loud, which is correct: deploys are prod-only.
    function _creationCode(
        string memory name
    ) internal view returns (bytes memory) {
        return vm.getCode(string.concat("forge-artifacts-prod/", name, ".sol/", name, ".json"));
    }

    function _meta(
        string memory name
    ) internal view returns (Meta memory) {
        bytes32 k = keccak256(bytes(name));
        if (k == keccak256("Dictate")) {
            return Meta({creationCode: _creationCode(name), ctorArgs: abi.encode(GOVERNOR_ADDRESS), class: Class.Root});
        }
        if (k == keccak256("Register")) {
            return
                Meta({
                    creationCode: _creationCode(name), ctorArgs: abi.encode(_specAddr("Dictate")), class: Class.Store
                });
        }
        if (k == keccak256("Chain")) {
            return
                Meta({creationCode: _creationCode(name), ctorArgs: abi.encode(_specAddr("Dictate")), class: Class.Root});
        }
        if (k == keccak256("UserAccount")) {
            return Meta({creationCode: _creationCode(name), ctorArgs: "", class: Class.Root});
        }
        if (k == keccak256("FundAccount")) {
            return Meta({creationCode: _creationCode(name), ctorArgs: "", class: Class.Root});
        }
        if (k == keccak256("AccountModule")) {
            return Meta({
                creationCode: _creationCode(name),
                ctorArgs: abi.encode(
                    _specAddr("Dictate"),
                    _specAddr("Chain"),
                    _specAddr("UserAccount"),
                    _specAddr("FundAccount"),
                    _const.readUint(".PROTOCOL.withdrawDelay")
                ),
                class: Class.Root
            });
        }
        if (k == keccak256("Deposit")) {
            return Meta({
                creationCode: _creationCode(name),
                ctorArgs: abi.encode(
                    _specAddr("Dictate"),
                    _specAddr("AccountModule"),
                    _specAddr("Register"),
                    address(_getChainToken(_wntSymbol()))
                ),
                class: Class.Logic
            });
        }
        if (k == keccak256("Fund")) {
            return Meta({
                creationCode: _creationCode(name),
                ctorArgs: abi.encode(
                    _specAddr("Dictate"),
                    _specAddr("AccountModule"),
                    _specAddr("MandateStore"),
                    _specAddr("FundStore"),
                    _specAddr("EscrowStore"),
                    _specAddr("Register"),
                    _specAddr("Share")
                ),
                class: Class.Logic
            });
        }
        if (k == keccak256("Share")) {
            return Meta({
                creationCode: _creationCode(name),
                ctorArgs: abi.encode(_proxyAddr(bytes32("Fund"))),
                class: Class.Root
            });
        }
        if (k == keccak256("FundStore") || k == keccak256("MandateStore") || k == keccak256("EscrowStore")) {
            return
                Meta({
                    creationCode: _creationCode(name), ctorArgs: abi.encode(_specAddr("Dictate")), class: Class.Store
                });
        }
        if (k == keccak256("SpokeGate")) {
            return Meta({
                creationCode: _creationCode(name),
                ctorArgs: abi.encode(
                    _specAddr("AccountModule"),
                    _specAddr("Register"),
                    _proxyAddr(bytes32("Deposit")),
                    _specAddr("EscrowStore"),
                    _gateConfig()
                ),
                class: Class.Logic
            });
        }
        if (k == keccak256("HubGate")) {
            return Meta({
                creationCode: _creationCode(name),
                ctorArgs: abi.encode(
                    _specAddr("AccountModule"),
                    _specAddr("Register"),
                    _proxyAddr(bytes32("Deposit")),
                    _specAddr("MandateStore"),
                    _proxyAddr(bytes32("Fund")),
                    _specAddr("EscrowStore"),
                    _gateConfig(),
                    _getMaxCohortSize(),
                    _const.readUint(".PROTOCOL.performanceFee")
                ),
                class: Class.Logic
            });
        }
        revert(string.concat("Deploy: unknown contract ", name));
    }

    function _verify(
        string memory name
    ) internal {
        address addr = _addrOrZero(name);
        if (addr == address(0)) {
            console2.log("skip (not on chain):", name);
            return;
        }
        Meta memory m = _meta(name);
        if (_isRouter(name)) {
            address impl = _addrOrZero(string.concat(name, "Impl"));
            _verifyContract(impl, name, m.ctorArgs);
            _verifyContract(addr, "RouterProxy", abi.encode(_specAddr("Dictate")));
            return;
        }
        if (keccak256(bytes(name)) == keccak256("Chain")) _verifyContract(_addrOrZero("ChainImpl"), _chainImpl(), "");
        _verifyContract(addr, name, m.ctorArgs);
    }

    function _verifyContract(
        address addr,
        string memory artifact,
        bytes memory ctorArgs
    ) internal {
        if (addr == address(0) || addr.code.length == 0) {
            console2.log("skip (not on chain):", artifact);
            return;
        }
        string[] memory cmd = new string[](11);
        cmd[0] = "forge";
        cmd[1] = "verify-contract";
        cmd[2] = vm.toString(addr);
        cmd[3] = artifact;
        cmd[4] = "--constructor-args";
        cmd[5] = vm.toString(ctorArgs);
        cmd[6] = "--watch";
        // The harness restriction on script/ + test/ leaves two compilation profiles in the cache; without pinning the
        // src unit's profile the verifier refuses with "Ambiguous compilation profiles found in cache".
        cmd[7] = "--compilation-profile";
        cmd[8] = "default";
        cmd[9] = "--chain";
        cmd[10] = _chainKey();
        Vm.FfiResult memory r = vm.tryFfi(cmd);
        if (r.exitCode == 0) {
            console2.log("verified:", artifact, vm.toString(addr));
        } else {
            console2.log("verify failed:", artifact, vm.toString(addr));
            console2.log(string(r.stderr));
        }
    }

    function _addrOrZero(
        string memory name
    ) internal view returns (address) {
        string memory fresh = vm.readFile(DEPLOYMENTS_PATH);
        string memory chainKey = string.concat(".chain.", _chainKey(), ".", name);
        if (vm.keyExistsToml(fresh, chainKey)) return fresh.readAddress(chainKey);
        return address(0);
    }
}
