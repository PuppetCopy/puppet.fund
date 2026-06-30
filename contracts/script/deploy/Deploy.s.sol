// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vm} from "forge-std/src/Vm.sol";
import {console2} from "forge-std/src/console2.sol";
import {stdToml} from "forge-std/src/StdToml.sol";

import {BaseScript} from "./shared/BaseScript.s.sol";

import {Dictate} from "src/core/Dictate.sol";
import {Register} from "src/core/Register.sol";
import {NATIVE_TOKEN} from "src/utils/Native.sol";
import {Account as AccountContract} from "src/core/Account.sol";
import {Attest} from "src/core/Attest.sol";
import {PuppetAccount} from "src/core/PuppetAccount.sol";
import {FundAccount} from "src/core/FundAccount.sol";
import {Route} from "src/core/Route.sol";
import {Deposit} from "src/core/Deposit.sol";
import {BaseGate} from "src/utils/BaseGate.sol";
import {Access} from "src/utils/auth/Access.sol";
import {Permission} from "src/utils/auth/Permission.sol";
import {PuppetGate} from "src/PuppetGate.sol";
import {FundGate} from "src/FundGate.sol";
import {HubGate} from "src/HubGate.sol";
import {ShareToken} from "src/hub/ShareToken.sol";
import {Issue} from "src/hub/Issue.sol";
import {Redeem} from "src/hub/Redeem.sol";
import {RedeemStore} from "src/hub/store/RedeemStore.sol";
import {Mandate} from "src/hub/Mandate.sol";
import {Allocate} from "src/hub/Allocate.sol";
import {AllocateStore} from "src/hub/store/AllocateStore.sol";

contract Deploy is BaseScript {
    using stdToml for string;

    function _requireDeployConfig() internal view {
        require(ATTESTOR_ADDRESS != address(0), "Deploy: ATTESTOR_ADDRESS is zero");
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
        if (isHub) _resetBroadcastForUniverse();

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

        _planAndGate(names);
        vm.startBroadcast(DEPLOYER_PRIVATE_KEY);
        _executePlan();
        _wireCore();
        if (isHub) _wireHub();
        _registerTokens();
        vm.stopBroadcast();
    }

    // The pre-broadcast gate is the doctrine's enforcement point: logic swaps are free,
    // a store re-key demands an explicit MIGRATE_STORES ack, and a root re-key is only
    // sanctioned by a protocol.version bump (= deliberate universe migration). The
    // universe signal is derived, not recorded: Dictate's address is a pure function of
    // the version salt, so a moved Dictate anchor IS the bump. Nothing is signed or
    // written before the whole plan passes.
    function _planAndGate(
        string[] memory names
    ) internal {
        uint version = _getVersion();
        bool universe = _isUniverseMigration(version);
        string memory storeAck = vm.envOr("MIGRATE_STORES", string(""));
        bytes32 salt = bytes32(version);
        bool refused;
        console2.log("=== deploy plan | version:", version, universe ? "| UNIVERSE MIGRATION" : "");
        for (uint i; i < names.length; ++i) {
            Meta memory m = _meta(names[i]);
            bytes32 initCodeHash = keccak256(bytes.concat(m.creationCode, m.ctorArgs));
            address predicted = address(
                uint160(uint(keccak256(abi.encodePacked(bytes1(0xff), address(FACTORY), salt, initCodeHash))))
            );
            _plannedAddr[keccak256(bytes(names[i]))] = predicted;
            address prev = _addrOrZero(_isRouter(names[i]) ? string.concat(names[i], "Impl") : names[i]);
            bool deployNeeded = predicted.code.length == 0;
            bool drift = prev != address(0) && prev != predicted;
            _plan.push(
                Plan({
                    name: names[i],
                    class: m.class,
                    universal: m.universal,
                    predicted: predicted,
                    prev: prev,
                    deployNeeded: deployNeeded
                })
            );
            console2.log(
                string.concat(
                    _classLabel(m.class), drift ? " drift " : (deployNeeded ? " new   " : " keep  "), names[i]
                ),
                predicted
            );
            if (drift && !universe) {
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
    ) internal returns (bool) {
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

    function _grantPermission(
        Dictate dictate,
        string memory targetName,
        bytes4 selector,
        string memory granteeName
    ) internal {
        dictate.setPermission(Permission(_specAddr(targetName)), selector, _specAddr(granteeName));
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
        for (uint i; i + n.length <= h.length; ++i) {
            bool ok = true;
            for (uint j; j < n.length; ++j) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }

    function redeployGate(
        string memory name
    ) public {
        require(bytes(name).length <= 32, "Deploy: gate name exceeds bytes32");
        vm.startBroadcast(DEPLOYER_PRIVATE_KEY);
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
        vm.startBroadcast(DEPLOYER_PRIVATE_KEY);
        _registerTokens();
        vm.stopBroadcast();
    }

    function _registerTokens() internal {
        Dictate dictate = Dictate(_specAddr("Dictate"));
        Register register = Register(_specAddr("Register"));
        string[] memory symbols = vm.parseTomlKeys(_const, string.concat(".TOKEN_ADDRESS.", _chainKey()));
        dictate.setAccess(register, DEPLOYER_ADDRESS);
        for (uint i; i < symbols.length; ++i) {
            address raw = _const.readAddress(string.concat(".TOKEN_ADDRESS.", _chainKey(), ".", symbols[i]));
            IERC20 token = raw == NATIVE_TOKEN ? IERC20(NATIVE_TOKEN) : _getChainToken(symbols[i]);
            register.registerToken(address(token), type(uint).max);
        }
        register.setWnt(address(_getChainToken(_wntSymbol())));
        string memory _providerPath = string.concat(".SWAP_PROVIDER.", _chainKey());
        if (vm.keyExistsToml(_const, _providerPath)) {
            string[] memory providers = vm.parseTomlKeys(_const, _providerPath);
            for (uint i; i < providers.length; ++i) {
                register.setProvider(_const.readAddress(string.concat(_providerPath, ".", providers[i])), type(uint).max);
            }
        }
    }

    function setSwapProvider(
        address provider,
        uint cap
    ) public {
        Dictate dictate = Dictate(_specAddr("Dictate"));
        Register register = Register(_specAddr("Register"));
        vm.startBroadcast(DEPLOYER_PRIVATE_KEY);
        dictate.setAccess(register, DEPLOYER_ADDRESS);
        register.setProvider(provider, cap);
        vm.stopBroadcast();
    }

    function registerToken(
        string calldata symbol
    ) public {
        Dictate dictate = Dictate(_specAddr("Dictate"));
        Register register = Register(_specAddr("Register"));
        IERC20 token = _getChainToken(symbol);
        vm.startBroadcast(DEPLOYER_PRIVATE_KEY);
        dictate.setAccess(register, DEPLOYER_ADDRESS);
        register.registerToken(address(token), type(uint).max);
        vm.stopBroadcast();
    }

    function cleanup() public {
        require(vm.envOr("ALLOW_DECOMMISSION", false), "Deploy: set ALLOW_DECOMMISSION=true to decommission gates");
        Dictate dictate = Dictate(_specAddr("Dictate"));
        bytes32[] memory targets;
        if (block.chainid == _getHubChainId()) {
            targets = new bytes32[](3);
            targets[0] = "PuppetGate";
            targets[1] = "FundGate";
            targets[2] = "HubGate";
        } else {
            targets = new bytes32[](2);
            targets[0] = "PuppetGate";
            targets[1] = "FundGate";
        }

        vm.startBroadcast(DEPLOYER_PRIVATE_KEY);
        for (uint i; i < targets.length; ++i) {
            try dictate.removeGate(targets[i]) {} catch {}
        }
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
        names = new string[](10);
        names[0] = "Dictate";
        names[1] = "Register";
        names[2] = "PuppetAccount";
        names[3] = "FundAccount";
        names[4] = "Route";
        names[5] = "Attest";
        names[6] = "Account";
        names[7] = "Deposit";
        names[8] = "PuppetGate";
        names[9] = "FundGate";
    }

    function _hubContracts() internal pure returns (string[] memory names) {
        names = new string[](8);
        names[0] = "ShareToken";
        names[1] = "Issue";
        names[2] = "RedeemStore";
        names[3] = "Redeem";
        names[4] = "AllocateStore";
        names[5] = "Mandate";
        names[6] = "Allocate";
        names[7] = "HubGate";
    }

    function _wireCore() internal {
        Dictate dictate = Dictate(_specAddr("Dictate"));
        AccountContract accountModule = AccountContract(_specAddr("Account"));
        Deposit walletDeposit = Deposit(_specAddr("Deposit"));

        // Account is the ONLY authorized caller of Attest.execute/executeMandate (the account's gate).
        _grantAccess(dictate, "Attest", "Account");

        address puppetGateImpl = _specAddr("PuppetGate");
        address puppetGateProxy = dictate.setGate("PuppetGate", puppetGateImpl);
        _setChainAddress("PuppetGateImpl", puppetGateImpl);
        _setChainAddress("PuppetGate", puppetGateProxy);

        dictate.setPermission(accountModule, AccountContract.dispatch.selector, puppetGateProxy);
        dictate.setPermission(accountModule, AccountContract.createPuppetAccount.selector, puppetGateProxy);
        dictate.setAccess(walletDeposit, puppetGateProxy);

        address fundGateImpl = _specAddr("FundGate");
        address fundGateProxy = dictate.setGate("FundGate", fundGateImpl);
        _setChainAddress("FundGateImpl", fundGateImpl);
        _setChainAddress("FundGate", fundGateProxy);

        dictate.setPermission(accountModule, AccountContract.dispatch.selector, fundGateProxy);
        dictate.setPermission(accountModule, AccountContract.createFundAccount.selector, fundGateProxy);
        dictate.setPermission(accountModule, AccountContract.createPuppetAccount.selector, fundGateProxy);
    }

    function _wireHub() internal {
        Dictate dictate = Dictate(_specAddr("Dictate"));
        AccountContract accountModule = AccountContract(_specAddr("Account"));
        Access mandate = Access(_specAddr("Mandate"));
        Access allocate = Access(_specAddr("Allocate"));
        Access redeem = Access(_specAddr("Redeem"));

        address hubImpl = _specAddr("HubGate");
        address hubProxy = dictate.setGate("HubGate", hubImpl);
        _setChainAddress("HubGateImpl", hubImpl);
        _setChainAddress("HubGate", hubProxy);

        _grantAccess(dictate, "AllocateStore", "Mandate");
        _grantAccess(dictate, "AllocateStore", "Allocate");
        _grantAccess(dictate, "RedeemStore", "Redeem");
        _grantAccess(dictate, "Issue", "Allocate");
        _grantAccess(dictate, "Issue", "Redeem");
        dictate.setAccess(mandate, hubProxy);
        dictate.setAccess(allocate, hubProxy);
        dictate.setAccess(redeem, hubProxy);

        dictate.setPermission(accountModule, AccountContract.dispatch.selector, hubProxy);
        dictate.setPermission(accountModule, AccountContract.createPuppetAccount.selector, hubProxy);
        _grantPermission(dictate, "Account", AccountContract.createFundAccount.selector, "Allocate");
        _grantPermission(dictate, "Account", AccountContract.dispatch.selector, "Mandate");
        _grantPermission(dictate, "Account", AccountContract.dispatch.selector, "Allocate");
        _grantPermission(dictate, "Account", AccountContract.dispatchMandate.selector, "Allocate");
        _grantPermission(dictate, "Account", AccountContract.dispatch.selector, "Redeem");
    }

    function _gateConfig() internal view returns (BaseGate.Config memory) {
        return BaseGate.Config({
            attestor: ATTESTOR_ADDRESS,
            feeReceiver: RELAYER_ADDRESS,
            transferGasLimit: _getTransferGasLimit(),
            maxBlockDelay: _getMaxBlockDelay(),
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
        bool universal;
    }

    struct Plan {
        string name;
        Class class;
        bool universal;
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

    function _meta(
        string memory name
    ) internal returns (Meta memory) {
        bytes32 k = keccak256(bytes(name));
        if (k == keccak256("Dictate")) {
            return
                Meta({creationCode: type(Dictate).creationCode, ctorArgs: abi.encode(GOVERNOR_ADDRESS), class: Class.Root, universal: true});
        }
        if (k == keccak256("Register")) {
            return Meta({
                creationCode: type(Register).creationCode,
                ctorArgs: abi.encode(_specAddr("Dictate")),
                class: Class.Store,
                universal: true
            });
        }
        if (k == keccak256("PuppetAccount")) {
            return Meta({creationCode: type(PuppetAccount).creationCode, ctorArgs: "", class: Class.Root, universal: true});
        }
        if (k == keccak256("FundAccount")) {
            return Meta({creationCode: type(FundAccount).creationCode, ctorArgs: "", class: Class.Root, universal: true});
        }
        if (k == keccak256("Route")) {
            return Meta({creationCode: type(Route).creationCode, ctorArgs: "", class: Class.Root, universal: true});
        }
        if (k == keccak256("Attest")) {
            return
                Meta({
                    creationCode: type(Attest).creationCode,
                    ctorArgs: abi.encode(_specAddr("Dictate")),
                    class: Class.Root,
                    universal: true
                });
        }
        if (k == keccak256("Account")) {
            return Meta({
                creationCode: type(AccountContract).creationCode,
                ctorArgs: abi.encode(
                    _specAddr("Dictate"),
                    _specAddr("Attest"),
                    _specAddr("PuppetAccount"),
                    _specAddr("FundAccount"),
                    _specAddr("Route")
                ),
                class: Class.Store,
                universal: true
            });
        }
        if (k == keccak256("Deposit")) {
            return
                Meta({
                    creationCode: type(Deposit).creationCode,
                    ctorArgs: abi.encode(_specAddr("Dictate")),
                    class: Class.Logic,
                    universal: true
                });
        }
        if (k == keccak256("PuppetGate")) {
            return Meta({
                creationCode: type(PuppetGate).creationCode,
                ctorArgs: abi.encode(
                    _specAddr("Dictate"),
                    _specAddr("Account"),
                    _specAddr("Deposit"),
                    _specAddr("Register"),
                    _gateConfig()
                ),
                class: Class.Logic,
                universal: false
            });
        }
        if (k == keccak256("FundGate")) {
            return Meta({
                creationCode: type(FundGate).creationCode,
                ctorArgs: abi.encode(
                    _specAddr("Dictate"),
                    _specAddr("Account"),
                    _specAddr("Register"),
                    _gateConfig()
                ),
                class: Class.Logic,
                universal: false
            });
        }
        if (k == keccak256("ShareToken")) {
            return Meta({
                creationCode: type(ShareToken).creationCode,
                ctorArgs: abi.encode(_getHubChainId()),
                class: Class.Root,
                universal: false
            });
        }
        if (k == keccak256("Issue")) {
            return Meta({
                creationCode: type(Issue).creationCode,
                ctorArgs: abi.encode(_specAddr("Dictate"), _specAddr("ShareToken")),
                class: Class.Root,
                universal: false
            });
        }
        if (k == keccak256("RedeemStore")) {
            return Meta({
                creationCode: type(RedeemStore).creationCode,
                ctorArgs: abi.encode(_specAddr("Dictate")),
                class: Class.Store,
                universal: false
            });
        }
        if (k == keccak256("Redeem")) {
            return
                Meta({
                    creationCode: type(Redeem).creationCode,
                    ctorArgs: abi.encode(_specAddr("Dictate")),
                    class: Class.Logic,
                    universal: false
                });
        }
        if (k == keccak256("AllocateStore")) {
            return Meta({
                creationCode: type(AllocateStore).creationCode,
                ctorArgs: abi.encode(_specAddr("Dictate")),
                class: Class.Store,
                universal: false
            });
        }
        if (k == keccak256("Mandate")) {
            return Meta({
                creationCode: type(Mandate).creationCode,
                ctorArgs: abi.encode(_specAddr("Dictate")),
                class: Class.Logic,
                universal: false
            });
        }
        if (k == keccak256("Allocate")) {
            return Meta({
                creationCode: type(Allocate).creationCode,
                ctorArgs: abi.encode(_specAddr("Dictate")),
                class: Class.Logic,
                universal: false
            });
        }
        if (k == keccak256("HubGate")) {
            return Meta({
                creationCode: type(HubGate).creationCode,
                ctorArgs: abi.encode(
                    _specAddr("Dictate"),
                    _specAddr("Account"),
                    _specAddr("Issue"),
                    _specAddr("Allocate"),
                    _specAddr("AllocateStore"),
                    _specAddr("Mandate"),
                    _specAddr("Redeem"),
                    _specAddr("RedeemStore"),
                    _specAddr("Register"),
                    _gateConfig()
                ),
                class: Class.Logic,
                universal: false
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
            _verifyContract(addr, "RouterProxy", abi.encode(_specAddr("Dictate"), impl, ""));
            return;
        }
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
        string[] memory cmd = new string[](custom ? 13 : 9);
        cmd[0] = "forge";
        cmd[1] = "verify-contract";
        cmd[2] = vm.toString(addr);
        cmd[3] = artifact;
        cmd[4] = "--chain";
        cmd[5] = custom ? vm.toString(block.chainid) : _chainKey();
        cmd[6] = "--constructor-args";
        cmd[7] = vm.toString(ctorArgs);
        cmd[8] = "--watch";
        if (custom) {
            cmd[9] = "--verifier";
            cmd[10] = _const.readString(string.concat(verifierPath, ".verifier"));
            cmd[11] = "--verifier-url";
            cmd[12] = _const.readString(string.concat(verifierPath, ".url"));
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
    ) internal returns (address) {
        string memory fresh = vm.readFile(_deploymentsPath());
        string memory chainKey = string.concat(".chain.", _chainKey(), ".", name);
        if (vm.keyExistsToml(fresh, chainKey)) return fresh.readAddress(chainKey);
        return address(0);
    }
}
