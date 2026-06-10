// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {Test} from "forge-std/src/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Dictate} from "src/core/Dictate.sol";
import {Attest} from "src/core/Attest.sol";
import {Account as AccountContract, CREATE_PUPPET_ACCOUNT_INTENT_TYPEHASH} from "src/core/Account.sol";
import {RegisterToken} from "src/core/RegisterToken.sol";
import {Deposit} from "src/core/Deposit.sol";
import {PuppetAccount} from "src/core/PuppetAccount.sol";
import {FundAccount} from "src/core/FundAccount.sol";
import {Route} from "src/core/Route.sol";
import {AccountLib, ACCOUNT_TYPEHASH} from "src/utils/AccountLib.sol";

import {BaseGate} from "src/utils/BaseGate.sol";
import {AccountGate} from "src/AccountGate.sol";
import {MasterGate} from "src/MasterGate.sol";
import {HubGate} from "src/HubGate.sol";

import {ShareToken} from "src/hub/ShareToken.sol";
import {Issue} from "src/hub/Issue.sol";
import {Allocate} from "src/hub/Allocate.sol";
import {AllocateStore} from "src/hub/store/AllocateStore.sol";
import {Subscribe} from "src/hub/Subscribe.sol";
import {Redeem} from "src/hub/Redeem.sol";
import {RedeemStore} from "src/hub/store/RedeemStore.sol";
import {ShareLib, SHARE_INIT_TYPEHASH} from "src/utils/ShareLib.sol";

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
    RegisterToken register;
    AccountContract accountModule;
    Deposit walletDeposit;
    AccountGate accountGate;
    MasterGate masterGate;
    HubGate hubGate;
    Issue shareGate;
    Allocate allocate;
    AllocateStore allocateStore;
    Subscribe subscribe;
    Redeem redeem;
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
        register = new RegisterToken(dictate, HUB_CHAIN_ID);

        Attest attest = new Attest(dictate);
        accountModule = new AccountContract(
            dictate, attest, address(new PuppetAccount()), address(new FundAccount()), address(new Route())
        );
        dictate.setAccess(attest, address(accountModule));
        walletDeposit = new Deposit(dictate);

        shareGate = new Issue(dictate, accountModule, address(new ShareToken()));
        allocate = new Allocate(dictate);
        allocateStore = new AllocateStore(dictate);
        subscribe = new Subscribe(dictate);
        redeem = new Redeem(dictate);
        redeemStore = new RedeemStore(dictate);

        BaseGate.Config memory cfg = BaseGate.Config({
            attestor: attestor, feeReceiver: feeReceiver, transferGasLimit: GAS, maxBlockDelay: 50, maxRelayFeeBps: 2000
        });

        accountGate = new AccountGate(dictate, accountModule, walletDeposit, register, HUB_CHAIN_ID, cfg);
        masterGate = new MasterGate(dictate, accountModule, register, cfg);
        hubGate = new HubGate(
            dictate, accountModule, shareGate, allocate, allocateStore, subscribe, redeem, redeemStore, register, cfg
        );

        dictate.setPermission(accountModule, AccountContract.dispatch.selector, address(accountGate));
        dictate.setPermission(accountModule, AccountContract.createPuppetAccount.selector, address(accountGate));
        dictate.setAccess(walletDeposit, address(accountGate));

        dictate.setPermission(accountModule, AccountContract.dispatch.selector, address(masterGate));
        dictate.setPermission(accountModule, AccountContract.createFundAccount.selector, address(masterGate));

        dictate.setAccess(allocateStore, address(subscribe));
        dictate.setAccess(allocateStore, address(allocate));
        dictate.setAccess(redeemStore, address(redeem));
        dictate.setAccess(shareGate, address(allocate));
        dictate.setAccess(shareGate, address(redeem));
        dictate.setAccess(subscribe, address(hubGate));
        dictate.setAccess(allocate, address(hubGate));
        dictate.setAccess(redeem, address(hubGate));
        dictate.setPermission(accountModule, AccountContract.dispatch.selector, address(hubGate));
        dictate.setPermission(accountModule, AccountContract.createFundAccount.selector, address(allocate));
        dictate.setPermission(accountModule, AccountContract.dispatch.selector, address(subscribe));
        dictate.setPermission(accountModule, AccountContract.dispatch.selector, address(allocate));
        dictate.setPermission(accountModule, AccountContract.dispatchMandate.selector, address(allocate));
        dictate.setPermission(accountModule, AccountContract.dispatch.selector, address(redeem));

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

    function _share(
        address _master
    ) internal pure returns (ShareLib.ShareInitParams memory) {
        return ShareLib.ShareInitParams({master: _master, baseTokenId: USDC_ID, name: bytes32("Fund")});
    }

    function _hashShare(
        ShareLib.ShareInitParams memory _p
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(SHARE_INIT_TYPEHASH, _p.master, _p.baseTokenId, _p.name));
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
        AccountContract.CreatePuppetAccountIntent memory intent = AccountContract.CreatePuppetAccountIntent({
            params: _params(p.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: 0,
            chainId: block.chainid,
            tokenId: USDC_ID,
            initialDepositAmount: 0
        });
        bytes32 structHash = keccak256(
            abi.encode(
                CREATE_PUPPET_ACCOUNT_INTENT_TYPEHASH,
                _hashAccount(p.user, address(0)),
                intent.blockNumber,
                intent.deadline,
                intent.acceptableRelayFee,
                intent.nonce,
                intent.chainId,
                intent.tokenId,
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
