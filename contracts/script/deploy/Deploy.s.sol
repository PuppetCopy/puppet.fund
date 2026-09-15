// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vm} from "forge-std/src/Vm.sol";
import {console2} from "forge-std/src/console2.sol";
import {stdToml} from "forge-std/src/StdToml.sol";

import {BaseScript} from "./shared/BaseScript.s.sol";

import {Dictate} from "src/core/Dictate.sol";
import {Register} from "src/core/Register.sol";
import {Chain as ChainProxy} from "src/core/Chain.sol";
import {AccountModule as AccountContract} from "src/core/AccountModule.sol";
import {BaseGate} from "src/utils/BaseGate.sol";
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
        _wireCore();
        if (isHub) _wireHub();
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
        _wireCore();
        if (isHub) _wireHub();
        _registerTokens();
        vm.stopBroadcast();
    }

    function _planAndGate(
        bool isHub
    ) internal {
        string[] memory core = _coreContracts();
        string[] memory names = core;
        if (isHub) {
            string[] memory hub = _hubContracts();
            names = new string[](core.length + hub.length);
            for (uint i; i < core.length; ++i) {
                names[i] = core[i];
            }
            for (uint i; i < hub.length; ++i) {
                names[core.length + i] = hub[i];
            }
        }
        uint version = _getVersion();
        string memory storeAck = vm.envOr("MIGRATE_STORES", string(""));
        bytes32 salt = bytes32(version);
        bool refused;
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

    function _grantAccess(
        Dictate dictate,
        string memory targetName,
        string memory granteeName
    ) internal {
        dictate.setAccess(Access(_specAddr(targetName)), _specAddr(granteeName));
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
            uint cap = _getChainTokenCap(symbols[i]);
            if (cap == 0) continue;
            register.setRegistered(address(_getChainToken(symbols[i])), cap, bytes32(bytes(symbols[i])));
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
        uint cap = _getChainTokenCap(symbol);
        vm.startBroadcast(_deployerKey());
        dictate.setAccess(register, vm.addr(_deployerKey()));
        register.setRegistered(address(token), cap, bytes32(bytes(symbol)));
        dictate.removeAccess(register, vm.addr(_deployerKey()));
        vm.stopBroadcast();
    }

    function verify() public {
        string[] memory core = _coreContracts();
        for (uint i; i < core.length; ++i) {
            _verify(core[i]);
        }
        string[] memory hub = _hubContracts();
        for (uint i; i < hub.length; ++i) {
            _verify(hub[i]);
        }
    }

    function verify(
        string memory name
    ) public {
        _verify(name);
    }

    function _coreContracts() internal pure returns (string[] memory names) {
        names = new string[](8);
        names[0] = "Dictate";
        names[1] = "Register";
        names[2] = "Chain";
        names[3] = "Account";
        names[4] = "DepositRoute";
        names[5] = "AccountModule";
        names[6] = "Deposit";
        names[7] = "CoreGate";
    }

    function _hubContracts() internal pure returns (string[] memory names) {
        names = new string[](2);
        names[0] = "BondStore";
        names[1] = "HubGate";
    }

    function _wireCore() internal {
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
        address coreGateImpl = _specAddr("CoreGate");
        address coreGateProxy = dictate.gateMap("CoreGate");
        if (coreGateProxy == address(0)) coreGateProxy = dictate.setGate("CoreGate", coreGateImpl);

        dictate.setAccess(Access(_specAddr("AccountModule")), coreGateProxy);
        dictate.setAccess(Access(_specAddr("AccountModule")), _specAddr("Deposit"));
        dictate.setAccess(Access(_specAddr("Deposit")), coreGateProxy);

        dictate.setGate("CoreGate", coreGateImpl);
        _setChainAddress("CoreGateImpl", coreGateImpl);
        _setChainAddress("CoreGate", coreGateProxy);
    }

    function _wireHub() internal {
        Dictate dictate = Dictate(_specAddr("Dictate"));
        address hubImpl = _specAddr("HubGate");
        address hubProxy = dictate.gateMap("HubGate");
        if (hubProxy == address(0)) hubProxy = dictate.setGate("HubGate", hubImpl);

        dictate.setAccess(Access(_specAddr("AccountModule")), hubProxy);
        dictate.setAccess(Access(_specAddr("Deposit")), hubProxy);
        dictate.setAccess(Access(_specAddr("BondStore")), hubProxy);

        dictate.setGate("HubGate", hubImpl);
        _setChainAddress("HubGateImpl", hubImpl);
        _setChainAddress("HubGate", hubProxy);
    }

    function _getMaxCohortSize() internal view returns (uint) {
        return _const.readUint(".PROTOCOL.maxCohortSize");
    }

    function _gateConfig() internal view returns (BaseGate.Config memory) {
        return BaseGate.Config({
            attestor: _attestorAddress(),
            feeReceiver: RELAYER_ADDRESS,
            transferGasLimit: _getTransferGasLimit(),
            maxIntentTtl: _const.readUint(".PROTOCOL.maxIntentTtlSec"),
            maxRelayFeeBps: _getMaxRelayFeeBps(),
            performanceFee: _const.readUint(".PROTOCOL.performanceFee"),
            maxCohortSize: _getMaxCohortSize()
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
        return n.length >= 4 && n[n.length - 4] == "G" && n[n.length - 3] == "a" && n[n.length - 2] == "t"
            && n[n.length - 1] == "e";
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
        if (k == keccak256("Account")) {
            return Meta({creationCode: _creationCode(name), ctorArgs: "", class: Class.Root});
        }
        if (k == keccak256("DepositRoute")) {
            return Meta({creationCode: _creationCode(name), ctorArgs: "", class: Class.Root});
        }
        if (k == keccak256("AccountModule")) {
            return Meta({
                creationCode: _creationCode(name),
                ctorArgs: abi.encode(
                    _specAddr("Dictate"),
                    _specAddr("Chain"),
                    _specAddr("Account"),
                    _specAddr("DepositRoute"),
                    _const.readUint(".PROTOCOL.resetPeriodSec")
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
                class: Class.Root
            });
        }
        if (k == keccak256("CoreGate")) {
            return Meta({
                creationCode: _creationCode(name),
                ctorArgs: abi.encode(
                    _specAddr("AccountModule"),
                    _specAddr("Register"),
                    _specAddr("Deposit"),
                    _gateConfig()
                ),
                class: Class.Logic
            });
        }
        if (k == keccak256("BondStore")) {
            return
                Meta({
                    creationCode: _creationCode(name), ctorArgs: abi.encode(_specAddr("Dictate")), class: Class.Store
                });
        }
        if (k == keccak256("HubGate")) {
            return Meta({
                creationCode: _creationCode(name),
                ctorArgs: abi.encode(
                    _specAddr("AccountModule"),
                    _specAddr("Register"),
                    _specAddr("Deposit"),
                    _specAddr("BondStore"),
                    address(_getChainToken(_const.readString(".PROTOCOL.bondToken"))),
                    _gateConfig()
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
        string memory verifierPath = string.concat(".VERIFIER.", _chainKey());
        bool custom = vm.keyExistsToml(_const, verifierPath);
        // A custom verifier carries its chain in the URL and MUST NOT get --chain: forge resolves that flag against its
        // own built-in chain table, which has no Monad mainnet (143), so passing it fails with "Chain not supported"
        // before the request is ever sent.
        string[] memory cmd = new string[](custom ? 15 : 11);
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
        if (custom) {
            cmd[9] = "--verifier";
            cmd[10] = _const.readString(string.concat(verifierPath, ".verifier"));
            cmd[11] = "--verifier-url";
            cmd[12] = _const.readString(string.concat(verifierPath, ".url"));
            cmd[13] = "--etherscan-api-key";
            cmd[14] = vm.envString("ETHERSCAN_API_KEY");
        } else {
            cmd[9] = "--chain";
            cmd[10] = _chainKey();
        }
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
