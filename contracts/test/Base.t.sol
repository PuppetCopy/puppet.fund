// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {Test} from "forge-std/src/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Dictate} from "src/core/Dictate.sol";
import {Attest} from "src/core/Attest.sol";
import {AccountModule, CREATE_PUPPET_ACCOUNT_INTENT_TYPEHASH} from "src/core/module/AccountModule.sol";
import {RegisterModule} from "src/core/module/RegisterModule.sol";
import {WalletDepositModule} from "src/core/module/WalletDepositModule.sol";
import {PuppetAccount} from "src/core/PuppetAccount.sol";
import {FundAccount} from "src/core/FundAccount.sol";
import {PassthroughRoute} from "src/core/PassthroughRoute.sol";
import {AccountLib, ACCOUNT_TYPEHASH} from "src/core/AccountLib.sol";

import {BaseGate} from "src/utils/BaseGate.sol";
import {AccountGate} from "src/AccountGate.sol";
import {MasterGate} from "src/MasterGate.sol";
import {HubGate} from "src/HubGate.sol";

import {ShareToken} from "src/hub/ShareToken.sol";
import {ShareModule} from "src/hub/ShareModule.sol";
import {AllocateModule} from "src/hub/AllocateModule.sol";
import {AllocateStore} from "src/hub/store/AllocateStore.sol";
import {SubscribeModule} from "src/hub/SubscribeModule.sol";
import {RedeemModule} from "src/hub/RedeemModule.sol";
import {RedeemStore} from "src/hub/store/RedeemStore.sol";

import {MockERC20} from "./mock/MockERC20.t.sol";
import {MockWNT} from "./mock/MockWNT.t.sol";

// Shared v2 deploy/wire/co-sign harness. Gates are used directly (no RouterProxy);
// setPermission/setAccess mark the gate+module loggable, so _logEvent works without setGate.
contract V2Base is Test {
    bytes32 constant USDC_ID = keccak256("USDC");
    bytes32 constant WETH_ID = keccak256("WETH");
    uint constant HUB_CHAIN_ID = 42_161;
    uint constant GAS = 200_000;
    uint constant SP = 1e12;

    address owner = makeAddr("Owner");
    address feeReceiver = makeAddr("FeeReceiver");
    address attestor;
    uint attestorKey;

    MockERC20 usdc;
    MockWNT wnt;

    Dictate dictate;
    RegisterModule register;
    AccountModule accountModule;
    WalletDepositModule walletDeposit;
    AccountGate accountGate;
    MasterGate masterGate;
    HubGate hubGate;
    ShareModule shareGate;
    AllocateModule allocate;
    AllocateStore allocateStore;
    SubscribeModule subscribe;
    RedeemModule redeem;
    RedeemStore redeemStore;

    bytes32 accountGateDomain;
    bytes32 masterGateDomain;
    bytes32 hubGateDomain;

    function setUp() public virtual {
        vm.chainId(HUB_CHAIN_ID);
        (attestor, attestorKey) = makeAddrAndKey("Attestor");

        vm.startPrank(owner);
        usdc = new MockERC20("USDC", "USDC", 6);
        wnt = new MockWNT();
        dictate = new Dictate(owner);
        register = new RegisterModule(dictate, HUB_CHAIN_ID);

        Attest attest = new Attest(dictate);
        accountModule = new AccountModule(
            dictate, attest, address(new PuppetAccount()), address(new FundAccount()), address(new PassthroughRoute())
        );
        dictate.setAccess(attest, address(accountModule));
        walletDeposit = new WalletDepositModule(dictate);

        shareGate = new ShareModule(dictate, address(new ShareToken()));
        allocate = new AllocateModule(dictate);
        allocateStore = new AllocateStore(dictate);
        subscribe = new SubscribeModule(dictate);
        redeem = new RedeemModule(dictate);
        redeemStore = new RedeemStore(dictate);

        BaseGate.Config memory cfg = BaseGate.Config({
            attestor: attestor, feeReceiver: feeReceiver, transferGasLimit: GAS, maxBlockDelay: 50, maxRelayFeeBps: 2000
        });

        accountGate = new AccountGate(dictate, accountModule, walletDeposit, register, HUB_CHAIN_ID, cfg);
        masterGate = new MasterGate(dictate, accountModule, register, cfg);
        hubGate = new HubGate(
            dictate, accountModule, shareGate, allocate, allocateStore, subscribe, redeem, redeemStore, register, cfg
        );

        dictate.setPermission(accountModule, AccountModule.dispatch.selector, address(accountGate));
        dictate.setPermission(accountModule, AccountModule.createPuppetAccount.selector, address(accountGate));
        dictate.setAccess(walletDeposit, address(accountGate));

        dictate.setPermission(accountModule, AccountModule.dispatch.selector, address(masterGate));
        dictate.setPermission(accountModule, AccountModule.createFundAccount.selector, address(masterGate));

        dictate.setAccess(allocateStore, address(subscribe));
        dictate.setAccess(allocateStore, address(allocate));
        dictate.setAccess(redeemStore, address(redeem));
        dictate.setAccess(shareGate, address(allocate));
        dictate.setAccess(shareGate, address(redeem));
        dictate.setAccess(subscribe, address(hubGate));
        dictate.setAccess(allocate, address(hubGate));
        dictate.setAccess(redeem, address(hubGate));
        dictate.setPermission(accountModule, AccountModule.dispatch.selector, address(hubGate));
        dictate.setPermission(accountModule, AccountModule.createFundAccount.selector, address(allocate));
        dictate.setPermission(accountModule, AccountModule.dispatch.selector, address(subscribe));
        dictate.setPermission(accountModule, AccountModule.dispatch.selector, address(allocate));
        dictate.setPermission(accountModule, AccountModule.dispatchMandate.selector, address(allocate));
        dictate.setPermission(accountModule, AccountModule.dispatch.selector, address(redeem));

        dictate.setAccess(register, owner);
        register.registerToken(USDC_ID, IERC20(address(usdc)), 0, address(usdc));
        register.registerToken(WETH_ID, IERC20(address(wnt)), 0, address(wnt));
        register.setWnt(WETH_ID);
        vm.stopPrank();

        accountGateDomain = _domainSep("AccountGate", address(accountGate));
        masterGateDomain = _domainSep("MasterGate", address(masterGate));
        hubGateDomain = _domainSep("HubGate", address(hubGate));
        vm.mockCall(address(100), abi.encodeWithSignature("arbBlockNumber()"), abi.encode(block.number));
    }

    function _domainSep(
        string memory _name,
        address _verifying
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(_name)),
                keccak256(bytes("1")),
                block.chainid,
                _verifying
            )
        );
    }

    function _digest(
        bytes32 _domain,
        bytes32 _structHash
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(hex"1901", _domain, _structHash));
    }

    function _sign(
        uint _key,
        bytes32 _hash
    ) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_key, _hash);
        return abi.encodePacked(r, s, v);
    }

    function _signDeploy(
        uint _key
    ) internal pure returns (bytes memory) {
        bytes memory _m = bytes("Puppet: Authorize session key");
        return _sign(_key, keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n", vm.toString(_m.length), _m)));
    }

    function _hashAccount(
        address _user,
        address _signer
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(ACCOUNT_TYPEHASH, _user, _signer));
    }

    function _seedSignedUsdc(
        address _acct,
        uint _amount
    ) internal {
        usdc.mint(_acct, _amount);
        vm.store(_acct, keccak256(abi.encode(USDC_ID, uint(0))), bytes32(_amount));
    }

    struct Puppet {
        PuppetAccount acct;
        address user;
        uint key;
        uint nonce;
    }

    function _params(
        address _user
    ) internal pure returns (AccountLib.AccountInitParams memory) {
        return AccountLib.AccountInitParams({user: _user, signer: address(0)});
    }

    function _makePuppet(
        string memory _label
    ) internal returns (Puppet memory p) {
        (p.user, p.key) = makeAddrAndKey(_label);
        AccountModule.CreatePuppetAccountIntent memory intent = AccountModule.CreatePuppetAccountIntent({
            params: _params(p.user),
            tokenId: USDC_ID,
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: 0,
            chainId: block.chainid,
            initialDepositAmount: 0
        });
        bytes32 structHash = keccak256(
            abi.encode(
                CREATE_PUPPET_ACCOUNT_INTENT_TYPEHASH,
                _hashAccount(p.user, address(0)),
                intent.tokenId,
                intent.blockNumber,
                intent.deadline,
                intent.acceptableRelayFee,
                intent.nonce,
                intent.chainId,
                intent.initialDepositAmount
            )
        );
        bytes32 digest = _digest(accountGateDomain, structHash);
        accountGate.createPuppetAccount(
            intent, _signDeploy(p.key), "", _sign(p.key, digest), _sign(attestorKey, digest), 0
        );
        p.acct = PuppetAccount(payable(accountModule.predictPuppetAccount(_params(p.user))));
        p.nonce = 1;
    }
}
