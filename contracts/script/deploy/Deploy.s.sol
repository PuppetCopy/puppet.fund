// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vm} from "forge-std/src/Vm.sol";
import {console2} from "forge-std/src/console2.sol";
import {stdToml} from "forge-std/src/StdToml.sol";

import {BaseScript} from "./shared/BaseScript.s.sol";

import {Dictate} from "src/core/Dictate.sol";
import {RegisterModule} from "src/core/module/RegisterModule.sol";
import {AccountModule} from "src/core/module/AccountModule.sol";
import {Attest} from "src/core/Attest.sol";
import {PuppetAccount} from "src/core/PuppetAccount.sol";
import {TransientRoute} from "src/core/TransientRoute.sol";
import {MasterAccount} from "src/core/MasterAccount.sol";
import {WalletDepositModule} from "src/core/module/WalletDepositModule.sol";
import {BaseGate} from "src/utils/BaseGate.sol";
import {PuppetGate} from "src/PuppetGate.sol";
import {MasterGate} from "src/MasterGate.sol";
import {HubGate} from "src/HubGate.sol";
import {ShareToken} from "src/hub/ShareToken.sol";
import {ShareModule} from "src/hub/ShareModule.sol";
import {RedeemModule} from "src/hub/module/RedeemModule.sol";
import {RedeemStore} from "src/hub/RedeemStore.sol";
import {SubscribeModule} from "src/hub/module/SubscribeModule.sol";
import {AllocateModule} from "src/hub/module/AllocateModule.sol";
import {AllocateStore} from "src/hub/AllocateStore.sol";

contract Deploy is BaseScript {
    using stdToml for string;

    function _requireDeployConfig() internal view {
        require(ATTESTOR_ADDRESS != address(0), "Deploy: ATTESTOR_ADDRESS is zero");
        require(RELAYER_ADDRESS != address(0), "Deploy: RELAYER_ADDRESS is zero");
    }

    function deployHub() public {
        require(block.chainid == _getHubChainId(), "Deploy: deployHub must run on the hub chain");
        _requireDeployConfig();
        vm.startBroadcast(DEPLOYER_PRIVATE_KEY);
        string[] memory core = _coreContracts();
        for (uint i; i < core.length; ++i) {
            _deploy(core[i]);
        }
        string[] memory hub = _hubContracts();
        for (uint i; i < hub.length; ++i) {
            _deploy(hub[i]);
        }
        _wireCore();
        _wireHub();
        vm.stopBroadcast();
    }

    function deploySpoke() public {
        require(block.chainid != _getHubChainId(), "Deploy: deploySpoke must run on a non-hub chain");
        _requireDeployConfig();
        vm.startBroadcast(DEPLOYER_PRIVATE_KEY);
        string[] memory core = _coreContracts();
        for (uint i; i < core.length; ++i) {
            _deploy(core[i]);
        }
        _wireCore();
        vm.stopBroadcast();
    }

    function redeployGate(
        string memory name
    ) public {
        require(bytes(name).length <= 32, "Deploy: gate name exceeds bytes32");
        vm.startBroadcast(DEPLOYER_PRIVATE_KEY);
        Dictate dictate = Dictate(_getCoreAddress("Dictate"));
        Meta memory m = _meta(name);
        address impl = _create(bytes.concat(m.creationCode, m.ctorArgs));
        bytes32 nameB;
        assembly {
            nameB := mload(add(name, 32))
        }
        address proxy = dictate.setGate(nameB, impl);
        _setChainAddress(string.concat(name, "Impl"), impl);
        _setChainAddress(name, proxy);
        vm.stopBroadcast();
    }

    function deployGateSplit() public {
        _requireDeployConfig();
        vm.startBroadcast(DEPLOYER_PRIVATE_KEY);
        Dictate dictate = Dictate(_getCoreAddress("Dictate"));
        AccountModule accountGate = AccountModule(_getCoreAddress("AccountModule"));
        WalletDepositModule walletDeposit = WalletDepositModule(_getCoreAddress("WalletDepositModule"));

        _deployAndWireGate(dictate, accountGate, walletDeposit, "PuppetGate", AccountModule.createPuppetAccount.selector);
        _deployAndWireGate(dictate, accountGate, walletDeposit, "MasterGate", AccountModule.createMasterAccount.selector);

        vm.stopBroadcast();
    }

    function retireCoreGate() public {
        vm.startBroadcast(DEPLOYER_PRIVATE_KEY);
        Dictate dictate = Dictate(_getCoreAddress("Dictate"));
        AccountModule accountGate = AccountModule(_getCoreAddress("AccountModule"));
        WalletDepositModule walletDeposit = WalletDepositModule(_getCoreAddress("WalletDepositModule"));

        address coreProxy = dictate.gateMap("CoreGate");
        require(coreProxy != address(0), "Deploy: CoreGate already retired");
        dictate.removePermission(accountGate, AccountModule.dispatch.selector, coreProxy);
        dictate.removePermission(accountGate, AccountModule.createPuppetAccount.selector, coreProxy);
        dictate.removePermission(accountGate, AccountModule.createMasterAccount.selector, coreProxy);
        dictate.removeAccess(walletDeposit, coreProxy);
        dictate.removeGate("CoreGate");

        vm.stopBroadcast();
    }

    function _deployAndWireGate(
        Dictate _dictate,
        AccountModule _accountGate,
        WalletDepositModule _walletDeposit,
        string memory _name,
        bytes4 _createSelector
    ) internal {
        Meta memory m = _meta(_name);
        address impl = _create(bytes.concat(m.creationCode, m.ctorArgs));
        bytes32 nameB;
        assembly {
            nameB := mload(add(_name, 32))
        }
        address proxy = _dictate.setGate(nameB, impl);
        _setChainAddress(string.concat(_name, "Impl"), impl);
        _setChainAddress(_name, proxy);
        _dictate.setPermission(_accountGate, AccountModule.dispatch.selector, proxy);
        _dictate.setPermission(_accountGate, _createSelector, proxy);
        _dictate.setAccess(_walletDeposit, proxy);
    }

    function registerTokens() public {
        Dictate dictate = Dictate(_getCoreAddress("Dictate"));
        RegisterModule register = RegisterModule(_getCoreAddress("RegisterModule"));
        string[2] memory symbols = ["USDC", "WETH"];

        vm.startBroadcast(DEPLOYER_PRIVATE_KEY);
        dictate.setAccess(register, DEPLOYER_ADDRESS);
        for (uint i; i < symbols.length; ++i) {
            IERC20 token = _getChainToken(symbols[i]);
            address hubToken = _const.readAddress(string.concat(".", _hubChainKey(), ".token.", symbols[i]));
            register.registerToken(keccak256(bytes(symbols[i])), token, 0, hubToken);
        }
        register.setWnt(keccak256("WETH"));
        dictate.removeAccess(register, DEPLOYER_ADDRESS);
        vm.stopBroadcast();
    }

    function cleanup() public {
        Dictate dictate = Dictate(_getCoreAddress("Dictate"));
        bytes32[] memory targets;
        if (block.chainid == _getHubChainId()) {
            targets = new bytes32[](3);
            targets[0] = "PuppetGate";
            targets[1] = "MasterGate";
            targets[2] = "HubGate";
        } else {
            targets = new bytes32[](2);
            targets[0] = "PuppetGate";
            targets[1] = "MasterGate";
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
        names[1] = "RegisterModule";
        names[2] = "PuppetAccount";
        names[3] = "TransientRoute";
        names[4] = "MasterAccount";
        names[5] = "Attest";
        names[6] = "AccountModule";
        names[7] = "WalletDepositModule";
        names[8] = "PuppetGate";
        names[9] = "MasterGate";
    }

    function _hubContracts() internal pure returns (string[] memory names) {
        names = new string[](8);
        names[0] = "ShareToken";
        names[1] = "ShareModule";
        names[2] = "RedeemStore";
        names[3] = "RedeemModule";
        names[4] = "AllocateStore";
        names[5] = "SubscribeModule";
        names[6] = "AllocateModule";
        names[7] = "HubGate";
    }

    function _deploy(
        string memory name
    ) internal returns (address addr) {
        Meta memory m = _meta(name);
        bytes memory initCode = bytes.concat(m.creationCode, m.ctorArgs);
        if (m.isCore) {
            addr = address(
                uint160(
                    uint(keccak256(abi.encodePacked(bytes1(0xff), address(FACTORY), bytes32(0), keccak256(initCode))))
                )
            );
            if (addr.code.length == 0) FACTORY.safeCreate2(bytes32(0), initCode);
            _setCoreAddress(name, addr, true);
            return addr;
        }
        addr = _create(initCode);
        _setChainAddress(name, addr);
    }

    function _wireCore() internal {
        Dictate dictate = Dictate(_specAddr("Dictate"));
        AccountModule accountGate = AccountModule(_specAddr("AccountModule"));
        WalletDepositModule walletDeposit = WalletDepositModule(_specAddr("WalletDepositModule"));

        // AccountModule is the ONLY authorized caller of Attest.execute/executeMandate (the account's gate).
        dictate.setAccess(Attest(_specAddr("Attest")), address(accountGate));

        address puppetImpl = _specAddr("PuppetGate");
        address puppetProxy = dictate.setGate("PuppetGate", puppetImpl);
        _setChainAddress("PuppetGateImpl", puppetImpl);
        _setChainAddress("PuppetGate", puppetProxy);

        dictate.setPermission(accountGate, AccountModule.dispatch.selector, puppetProxy);
        dictate.setPermission(accountGate, AccountModule.createPuppetAccount.selector, puppetProxy);
        dictate.setAccess(walletDeposit, puppetProxy);

        address masterImpl = _specAddr("MasterGate");
        address masterProxy = dictate.setGate("MasterGate", masterImpl);
        _setChainAddress("MasterGateImpl", masterImpl);
        _setChainAddress("MasterGate", masterProxy);

        dictate.setPermission(accountGate, AccountModule.dispatch.selector, masterProxy);
        dictate.setPermission(accountGate, AccountModule.createMasterAccount.selector, masterProxy);
        dictate.setAccess(walletDeposit, masterProxy);
    }

    function _wireHub() internal {
        Dictate dictate = Dictate(_specAddr("Dictate"));
        AccountModule accountGate = AccountModule(_specAddr("AccountModule"));
        ShareModule shareGate = ShareModule(_specAddr("ShareModule"));
        RedeemStore redeemStore = RedeemStore(_specAddr("RedeemStore"));
        AllocateStore allocateStore = AllocateStore(_specAddr("AllocateStore"));
        RedeemModule redeem = RedeemModule(_specAddr("RedeemModule"));
        SubscribeModule subscribe = SubscribeModule(_specAddr("SubscribeModule"));
        AllocateModule allocate = AllocateModule(_specAddr("AllocateModule"));

        address hubImpl = _specAddr("HubGate");
        address hubProxy = dictate.setGate("HubGate", hubImpl);
        _setChainAddress("HubGateImpl", hubImpl);
        _setChainAddress("HubGate", hubProxy);

        dictate.setAccess(allocateStore, address(subscribe));
        dictate.setAccess(allocateStore, address(allocate));
        dictate.setAccess(redeemStore, address(redeem));
        dictate.setAccess(shareGate, address(allocate));
        dictate.setAccess(shareGate, address(redeem));
        dictate.setAccess(shareGate, hubProxy);
        dictate.setAccess(subscribe, hubProxy);
        dictate.setAccess(allocate, hubProxy);
        dictate.setAccess(redeem, hubProxy);

        dictate.setPermission(accountGate, AccountModule.dispatch.selector, hubProxy);
        dictate.setPermission(accountGate, AccountModule.createMasterAccount.selector, hubProxy);
        dictate.setPermission(accountGate, AccountModule.dispatch.selector, address(subscribe));
        dictate.setPermission(accountGate, AccountModule.dispatch.selector, address(allocate));
        dictate.setPermission(accountGate, AccountModule.dispatchMandate.selector, address(allocate));
        dictate.setPermission(accountGate, AccountModule.dispatch.selector, address(redeem));
    }

    struct Meta {
        bytes creationCode;
        bytes ctorArgs;
        bool isCore;
    }

    function _isRouter(
        string memory name
    ) internal pure returns (bool) {
        bytes memory n = bytes(name);
        return n.length >= 4 && n[n.length - 4] == "G" && n[n.length - 3] == "a" && n[n.length - 2] == "t"
            && n[n.length - 1] == "e";
    }

    function _meta(
        string memory name
    ) internal view returns (Meta memory) {
        bytes32 k = keccak256(bytes(name));
        if (k == keccak256("Dictate")) {
            return
                Meta({creationCode: type(Dictate).creationCode, ctorArgs: abi.encode(GOVERNOR_ADDRESS), isCore: true});
        }
        if (k == keccak256("RegisterModule")) {
            return Meta({
                creationCode: type(RegisterModule).creationCode,
                ctorArgs: abi.encode(_specAddr("Dictate"), _getHubChainId()),
                isCore: true
            });
        }
        if (k == keccak256("PuppetAccount")) {
            return Meta({creationCode: type(PuppetAccount).creationCode, ctorArgs: "", isCore: true});
        }
        if (k == keccak256("TransientRoute")) {
            return Meta({creationCode: type(TransientRoute).creationCode, ctorArgs: "", isCore: true});
        }
        if (k == keccak256("MasterAccount")) {
            return Meta({creationCode: type(MasterAccount).creationCode, ctorArgs: "", isCore: true});
        }
        if (k == keccak256("Attest")) {
            return
                Meta({
                    creationCode: type(Attest).creationCode, ctorArgs: abi.encode(_specAddr("Dictate")), isCore: true
                });
        }
        if (k == keccak256("AccountModule")) {
            return Meta({
                creationCode: type(AccountModule).creationCode,
                ctorArgs: abi.encode(
                    _specAddr("Dictate"),
                    _specAddr("Attest"),
                    _specAddr("PuppetAccount"),
                    _specAddr("TransientRoute"),
                    _specAddr("MasterAccount")
                ),
                isCore: true
            });
        }
        if (k == keccak256("WalletDepositModule")) {
            return Meta({
                creationCode: type(WalletDepositModule).creationCode,
                ctorArgs: abi.encode(_specAddr("Dictate")),
                isCore: true
            });
        }
        if (k == keccak256("PuppetGate")) {
            return Meta({
                creationCode: type(PuppetGate).creationCode,
                ctorArgs: abi.encode(
                    _specAddr("Dictate"),
                    _specAddr("AccountModule"),
                    _specAddr("WalletDepositModule"),
                    _specAddr("RegisterModule"),
                    _getHubChainId(),
                    BaseGate.Config({
                        attestor: ATTESTOR_ADDRESS,
                        feeReceiver: RELAYER_ADDRESS,
                        transferGasLimit: _getTransferGasLimit(),
                        maxBlockDelay: _getMaxBlockDelay(),
                        maxRelayFeeBps: _getMaxRelayFeeBps()
                    })
                ),
                isCore: false
            });
        }
        if (k == keccak256("MasterGate")) {
            return Meta({
                creationCode: type(MasterGate).creationCode,
                ctorArgs: abi.encode(
                    _specAddr("Dictate"),
                    _specAddr("AccountModule"),
                    _specAddr("WalletDepositModule"),
                    _specAddr("RegisterModule"),
                    _getHubChainId(),
                    BaseGate.Config({
                        attestor: ATTESTOR_ADDRESS,
                        feeReceiver: RELAYER_ADDRESS,
                        transferGasLimit: _getTransferGasLimit(),
                        maxBlockDelay: _getMaxBlockDelay(),
                        maxRelayFeeBps: _getMaxRelayFeeBps()
                    })
                ),
                isCore: false
            });
        }
        if (k == keccak256("ShareToken")) {
            return Meta({creationCode: type(ShareToken).creationCode, ctorArgs: "", isCore: false});
        }
        if (k == keccak256("ShareModule")) {
            return Meta({
                creationCode: type(ShareModule).creationCode,
                ctorArgs: abi.encode(_specAddr("Dictate"), _specAddr("ShareToken")),
                isCore: false
            });
        }
        if (k == keccak256("RedeemStore")) {
            return Meta({
                creationCode: type(RedeemStore).creationCode, ctorArgs: abi.encode(_specAddr("Dictate")), isCore: false
            });
        }
        if (k == keccak256("RedeemModule")) {
            return Meta({
                creationCode: type(RedeemModule).creationCode, ctorArgs: abi.encode(_specAddr("Dictate")), isCore: false
            });
        }
        if (k == keccak256("AllocateStore")) {
            return Meta({
                creationCode: type(AllocateStore).creationCode,
                ctorArgs: abi.encode(_specAddr("Dictate")),
                isCore: false
            });
        }
        if (k == keccak256("SubscribeModule")) {
            return Meta({
                creationCode: type(SubscribeModule).creationCode,
                ctorArgs: abi.encode(_specAddr("Dictate")),
                isCore: false
            });
        }
        if (k == keccak256("AllocateModule")) {
            return Meta({
                creationCode: type(AllocateModule).creationCode,
                ctorArgs: abi.encode(_specAddr("Dictate")),
                isCore: false
            });
        }
        if (k == keccak256("HubGate")) {
            return Meta({
                creationCode: type(HubGate).creationCode,
                ctorArgs: abi.encode(
                    _specAddr("Dictate"),
                    _specAddr("AccountModule"),
                    _specAddr("ShareModule"),
                    _specAddr("AllocateModule"),
                    _specAddr("AllocateStore"),
                    _specAddr("SubscribeModule"),
                    _specAddr("RedeemModule"),
                    _specAddr("RedeemStore"),
                    _specAddr("RegisterModule"),
                    BaseGate.Config({
                        attestor: ATTESTOR_ADDRESS,
                        feeReceiver: RELAYER_ADDRESS,
                        transferGasLimit: _getTransferGasLimit(),
                        maxBlockDelay: _getMaxBlockDelay(),
                        maxRelayFeeBps: _getMaxRelayFeeBps()
                    })
                ),
                isCore: false
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
        string[] memory cmd = new string[](9);
        cmd[0] = "forge";
        cmd[1] = "verify-contract";
        cmd[2] = vm.toString(addr);
        cmd[3] = artifact;
        cmd[4] = "--chain";
        cmd[5] = _chainKey();
        cmd[6] = "--constructor-args";
        cmd[7] = vm.toString(ctorArgs);
        cmd[8] = "--watch";
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
        string memory coreKey = string.concat(".core.", name, ".address");
        if (vm.keyExistsToml(fresh, coreKey)) {
            address a = fresh.readAddress(coreKey);
            string memory cbm = string.concat(".core.", name, ".chainBlockMap.", vm.toString(block.chainid));
            if (a != address(0) && vm.keyExistsToml(fresh, cbm)) return a;
        }
        string memory chainKey = string.concat(".chain.", _chainKey(), ".", name);
        if (vm.keyExistsToml(fresh, chainKey)) return fresh.readAddress(chainKey);
        return address(0);
    }
}
