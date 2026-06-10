// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vm} from "forge-std/src/Vm.sol";
import {console2} from "forge-std/src/console2.sol";
import {stdToml} from "forge-std/src/StdToml.sol";

import {BaseScript} from "./shared/BaseScript.s.sol";

import {Dictate} from "src/core/Dictate.sol";
import {RegisterToken} from "src/core/RegisterToken.sol";
import {Account as AccountContract} from "src/core/Account.sol";
import {Attest} from "src/core/Attest.sol";
import {PuppetAccount} from "src/core/PuppetAccount.sol";
import {FundAccount} from "src/core/FundAccount.sol";
import {Route} from "src/core/Route.sol";
import {Deposit} from "src/core/Deposit.sol";
import {BaseGate} from "src/utils/BaseGate.sol";
import {AccountGate} from "src/AccountGate.sol";
import {MasterGate} from "src/MasterGate.sol";
import {HubGate} from "src/HubGate.sol";
import {ShareToken} from "src/hub/ShareToken.sol";
import {Issue} from "src/hub/Issue.sol";
import {Redeem} from "src/hub/Redeem.sol";
import {RedeemStore} from "src/hub/store/RedeemStore.sol";
import {Subscribe} from "src/hub/Subscribe.sol";
import {Allocate} from "src/hub/Allocate.sol";
import {AllocateStore} from "src/hub/store/AllocateStore.sol";

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
        _registerTokens();
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
        _registerTokens();
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

    function registerTokens() public {
        vm.startBroadcast(DEPLOYER_PRIVATE_KEY);
        _registerTokens();
        vm.stopBroadcast();
    }

    function _registerTokens() internal {
        Dictate dictate = Dictate(_specAddr("Dictate"));
        RegisterToken register = RegisterToken(_specAddr("RegisterToken"));
        string[2] memory symbols = ["USDC", "WETH"];
        dictate.setAccess(register, DEPLOYER_ADDRESS);
        for (uint i; i < symbols.length; ++i) {
            IERC20 token = _getChainToken(symbols[i]);
            address hubToken = _const.readAddress(string.concat(".", _hubChainKey(), ".token.", symbols[i]));
            register.registerToken(keccak256(bytes(symbols[i])), token, 0, hubToken);
        }
        register.setWnt(keccak256("WETH"));
        dictate.removeAccess(register, DEPLOYER_ADDRESS);
    }

    function cleanup() public {
        require(vm.envOr("ALLOW_DECOMMISSION", false), "Deploy: set ALLOW_DECOMMISSION=true to decommission gates");
        Dictate dictate = Dictate(_getCoreAddress("Dictate"));
        bytes32[] memory targets;
        if (block.chainid == _getHubChainId()) {
            targets = new bytes32[](3);
            targets[0] = "AccountGate";
            targets[1] = "MasterGate";
            targets[2] = "HubGate";
        } else {
            targets = new bytes32[](2);
            targets[0] = "AccountGate";
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
        names[1] = "RegisterToken";
        names[2] = "PuppetAccount";
        names[3] = "FundAccount";
        names[4] = "Route";
        names[5] = "Attest";
        names[6] = "Account";
        names[7] = "Deposit";
        names[8] = "AccountGate";
        names[9] = "MasterGate";
    }

    function _hubContracts() internal pure returns (string[] memory names) {
        names = new string[](8);
        names[0] = "ShareToken";
        names[1] = "Issue";
        names[2] = "RedeemStore";
        names[3] = "Redeem";
        names[4] = "AllocateStore";
        names[5] = "Subscribe";
        names[6] = "Allocate";
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
        AccountContract accountModule = AccountContract(_specAddr("Account"));
        Deposit walletDeposit = Deposit(_specAddr("Deposit"));

        // Account is the ONLY authorized caller of Attest.execute/executeMandate (the account's gate).
        dictate.setAccess(Attest(_specAddr("Attest")), address(accountModule));

        address accountGateImpl = _specAddr("AccountGate");
        address accountGateProxy = dictate.setGate("AccountGate", accountGateImpl);
        _setChainAddress("AccountGateImpl", accountGateImpl);
        _setChainAddress("AccountGate", accountGateProxy);

        dictate.setPermission(accountModule, AccountContract.dispatch.selector, accountGateProxy);
        dictate.setPermission(accountModule, AccountContract.createPuppetAccount.selector, accountGateProxy);
        dictate.setAccess(walletDeposit, accountGateProxy);

        address masterGateImpl = _specAddr("MasterGate");
        address masterGateProxy = dictate.setGate("MasterGate", masterGateImpl);
        _setChainAddress("MasterGateImpl", masterGateImpl);
        _setChainAddress("MasterGate", masterGateProxy);

        dictate.setPermission(accountModule, AccountContract.dispatch.selector, masterGateProxy);
        dictate.setPermission(accountModule, AccountContract.createFundAccount.selector, masterGateProxy);
    }

    function _wireHub() internal {
        Dictate dictate = Dictate(_specAddr("Dictate"));
        AccountContract accountModule = AccountContract(_specAddr("Account"));
        Issue shareModule = Issue(_specAddr("Issue"));
        RedeemStore redeemStore = RedeemStore(_specAddr("RedeemStore"));
        AllocateStore allocateStore = AllocateStore(_specAddr("AllocateStore"));
        Redeem redeem = Redeem(_specAddr("Redeem"));
        Subscribe subscribe = Subscribe(_specAddr("Subscribe"));
        Allocate allocate = Allocate(_specAddr("Allocate"));

        address hubImpl = _specAddr("HubGate");
        address hubProxy = dictate.setGate("HubGate", hubImpl);
        _setChainAddress("HubGateImpl", hubImpl);
        _setChainAddress("HubGate", hubProxy);

        dictate.setAccess(allocateStore, address(subscribe));
        dictate.setAccess(allocateStore, address(allocate));
        dictate.setAccess(redeemStore, address(redeem));
        dictate.setAccess(shareModule, address(allocate));
        dictate.setAccess(shareModule, address(redeem));
        dictate.setAccess(subscribe, hubProxy);
        dictate.setAccess(allocate, hubProxy);
        dictate.setAccess(redeem, hubProxy);

        dictate.setPermission(accountModule, AccountContract.dispatch.selector, hubProxy);
        dictate.setPermission(accountModule, AccountContract.createFundAccount.selector, address(allocate));
        dictate.setPermission(accountModule, AccountContract.dispatch.selector, address(subscribe));
        dictate.setPermission(accountModule, AccountContract.dispatch.selector, address(allocate));
        dictate.setPermission(accountModule, AccountContract.dispatchMandate.selector, address(allocate));
        dictate.setPermission(accountModule, AccountContract.dispatch.selector, address(redeem));
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
        if (k == keccak256("RegisterToken")) {
            return Meta({
                creationCode: type(RegisterToken).creationCode,
                ctorArgs: abi.encode(_specAddr("Dictate"), _getHubChainId()),
                isCore: true
            });
        }
        if (k == keccak256("PuppetAccount")) {
            return Meta({creationCode: type(PuppetAccount).creationCode, ctorArgs: "", isCore: true});
        }
        if (k == keccak256("FundAccount")) {
            return Meta({creationCode: type(FundAccount).creationCode, ctorArgs: "", isCore: true});
        }
        if (k == keccak256("Route")) {
            return Meta({creationCode: type(Route).creationCode, ctorArgs: "", isCore: true});
        }
        if (k == keccak256("Attest")) {
            return
                Meta({
                    creationCode: type(Attest).creationCode, ctorArgs: abi.encode(_specAddr("Dictate")), isCore: true
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
                isCore: true
            });
        }
        if (k == keccak256("Deposit")) {
            return
                Meta({
                    creationCode: type(Deposit).creationCode, ctorArgs: abi.encode(_specAddr("Dictate")), isCore: true
                });
        }
        if (k == keccak256("AccountGate")) {
            return Meta({
                creationCode: type(AccountGate).creationCode,
                ctorArgs: abi.encode(
                    _specAddr("Dictate"),
                    _specAddr("Account"),
                    _specAddr("Deposit"),
                    _specAddr("RegisterToken"),
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
                    _specAddr("Account"),
                    _specAddr("RegisterToken"),
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
        if (k == keccak256("Issue")) {
            return Meta({
                creationCode: type(Issue).creationCode,
                ctorArgs: abi.encode(_specAddr("Dictate"), _specAddr("Account"), _specAddr("ShareToken")),
                isCore: false
            });
        }
        if (k == keccak256("RedeemStore")) {
            return Meta({
                creationCode: type(RedeemStore).creationCode, ctorArgs: abi.encode(_specAddr("Dictate")), isCore: false
            });
        }
        if (k == keccak256("Redeem")) {
            return
                Meta({
                    creationCode: type(Redeem).creationCode, ctorArgs: abi.encode(_specAddr("Dictate")), isCore: false
                });
        }
        if (k == keccak256("AllocateStore")) {
            return Meta({
                creationCode: type(AllocateStore).creationCode,
                ctorArgs: abi.encode(_specAddr("Dictate")),
                isCore: false
            });
        }
        if (k == keccak256("Subscribe")) {
            return Meta({
                creationCode: type(Subscribe).creationCode, ctorArgs: abi.encode(_specAddr("Dictate")), isCore: false
            });
        }
        if (k == keccak256("Allocate")) {
            return Meta({
                creationCode: type(Allocate).creationCode, ctorArgs: abi.encode(_specAddr("Dictate")), isCore: false
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
                    _specAddr("Subscribe"),
                    _specAddr("Redeem"),
                    _specAddr("RedeemStore"),
                    _specAddr("RegisterToken"),
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
