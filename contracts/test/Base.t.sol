// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {Test} from "forge-std/src/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Dictate} from "src/core/Dictate.sol";
import {Attest} from "src/core/Attest.sol";
import {Account as AccountContract} from "src/core/Account.sol";
import {Register} from "src/core/Register.sol";
import {Deposit} from "src/core/Deposit.sol";
import {PuppetAccount} from "src/core/PuppetAccount.sol";
import {FundAccount} from "src/core/FundAccount.sol";
import {Route} from "src/core/Route.sol";
import {AccountLib, ACCOUNT_TYPEHASH} from "src/utils/AccountLib.sol";

import {BaseGate} from "src/utils/BaseGate.sol";
import {PuppetGate} from "src/PuppetGate.sol";
import {FundGate} from "src/FundGate.sol";
import {HubGate} from "src/HubGate.sol";

import {ShareToken} from "src/hub/ShareToken.sol";
import {Issue} from "src/hub/Issue.sol";
import {Allocate} from "src/hub/Allocate.sol";
import {AllocateStore} from "src/hub/store/AllocateStore.sol";
import {Mandate} from "src/hub/Mandate.sol";
import {Redeem} from "src/hub/Redeem.sol";
import {RedeemStore} from "src/hub/store/RedeemStore.sol";
import {FundAccountLib, FUND_ACCOUNT_INIT_TYPEHASH} from "src/utils/FundAccountLib.sol";

import {MockERC20} from "./mock/MockERC20.t.sol";
import {MockWNT} from "./mock/MockWNT.t.sol";

// Shared v2 deploy/wire/co-sign harness. Gates are used directly (no RouterProxy);
// setPermission/setAccess mark the gate+module loggable, so _logEvent works without setGate.
contract V2Base is Test {
    uint constant HUB_CHAIN_ID = 1;
    uint constant GAS = 200_000;
    uint constant SP = 1e12;

    address owner = makeAddr("Owner");
    address feeReceiver = makeAddr("FeeReceiver");
    address attestor;
    uint attestorKey;

    MockERC20 usdc;
    MockWNT wnt;

    Dictate dictate;
    Register register;
    AccountContract accountModule;
    Deposit walletDeposit;
    PuppetGate puppetGate;
    FundGate fundGate;
    HubGate hubGate;
    Issue shareGate;
    Allocate allocate;
    AllocateStore allocateStore;
    Mandate mandate;
    Redeem redeem;
    RedeemStore redeemStore;

    bytes32 puppetGateDomain;
    bytes32 fundGateDomain;
    bytes32 hubGateDomain;

    function setUp() public virtual {
        vm.chainId(HUB_CHAIN_ID);
        (attestor, attestorKey) = makeAddrAndKey("Attestor");

        vm.startPrank(owner);
        usdc = new MockERC20("USDC", "USDC", 6);
        wnt = new MockWNT();
        dictate = new Dictate(owner);
        register = new Register(dictate);

        Attest attest = new Attest(dictate);
        accountModule = new AccountContract(
            dictate, attest, address(new PuppetAccount()), address(new FundAccount()), address(new Route())
        );
        dictate.setAccess(attest, address(accountModule));
        walletDeposit = new Deposit(dictate);

        shareGate = new Issue(dictate, address(new ShareToken(HUB_CHAIN_ID)));
        allocate = new Allocate(dictate);
        allocateStore = new AllocateStore(dictate);
        mandate = new Mandate(dictate);
        redeem = new Redeem(dictate);
        redeemStore = new RedeemStore(dictate);

        BaseGate.Config memory cfg = BaseGate.Config({
            attestor: attestor, feeReceiver: feeReceiver, transferGasLimit: GAS, maxBlockDelay: 50, maxRelayFeeBps: 2000
        });

        puppetGate = new PuppetGate(dictate, accountModule, walletDeposit, register, cfg);
        fundGate = new FundGate(dictate, accountModule, register, cfg);
        hubGate = new HubGate(
            dictate, accountModule, shareGate, allocate, allocateStore, mandate, redeem, redeemStore, register, cfg
        );

        dictate.setPermission(accountModule, AccountContract.dispatch.selector, address(puppetGate));
        dictate.setPermission(accountModule, AccountContract.createPuppetAccount.selector, address(puppetGate));
        dictate.setAccess(walletDeposit, address(puppetGate));

        dictate.setPermission(accountModule, AccountContract.dispatch.selector, address(fundGate));
        dictate.setPermission(accountModule, AccountContract.createFundAccount.selector, address(fundGate));
        dictate.setPermission(accountModule, AccountContract.createPuppetAccount.selector, address(fundGate));
        dictate.setPermission(accountModule, AccountContract.createPuppetAccount.selector, address(this));
        dictate.setPermission(accountModule, AccountContract.createFundAccount.selector, address(this));

        dictate.setAccess(allocateStore, address(mandate));
        dictate.setAccess(allocateStore, address(allocate));
        dictate.setAccess(redeemStore, address(redeem));
        dictate.setAccess(shareGate, address(allocate));
        dictate.setAccess(shareGate, address(redeem));
        dictate.setAccess(mandate, address(hubGate));
        dictate.setAccess(allocate, address(hubGate));
        dictate.setAccess(redeem, address(hubGate));
        dictate.setPermission(accountModule, AccountContract.dispatch.selector, address(hubGate));
        dictate.setPermission(accountModule, AccountContract.createPuppetAccount.selector, address(hubGate));
        dictate.setPermission(accountModule, AccountContract.createFundAccount.selector, address(allocate));
        dictate.setPermission(accountModule, AccountContract.dispatch.selector, address(mandate));
        dictate.setPermission(accountModule, AccountContract.dispatch.selector, address(allocate));
        dictate.setPermission(accountModule, AccountContract.dispatchMandate.selector, address(allocate));
        dictate.setPermission(accountModule, AccountContract.dispatch.selector, address(redeem));

        dictate.setAccess(register, owner);
        register.registerToken(address(usdc), type(uint).max);
        register.registerToken(address(wnt), type(uint).max);
        register.setWnt(address(wnt));
        vm.stopPrank();

        puppetGateDomain = _domainSep("PuppetGate", address(puppetGate));
        fundGateDomain = _domainSep("FundGate", address(fundGate));
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

    function _fundParams(
        address _master
    ) internal view returns (FundAccountLib.FundAccountInitParams memory) {
        return FundAccountLib.FundAccountInitParams({master: _master, baseToken: address(usdc), name: bytes32("Fund")});
    }

    function _shareTokenOf(
        address _master
    ) internal view returns (address) {
        return address(hubGate.predictShareToken(_fundParams(_master)));
    }

    function _fundOf(
        address _master
    ) internal view returns (address) {
        return accountModule.predictFundAccount(_fundParams(_master));
    }

    function _hashFundParams(
        FundAccountLib.FundAccountInitParams memory _p
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(FUND_ACCOUNT_INIT_TYPEHASH, _p.master, _p.baseToken, _p.name));
    }

    function _seedSignedUsdc(
        address _acct,
        uint _amount
    ) internal {
        usdc.mint(_acct, _amount);
        vm.store(_acct, keccak256(abi.encode(address(usdc), uint(0))), bytes32(_amount));
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
        accountModule.createPuppetAccount(_params(p.user), _signDeploy(p.key), "");
        p.acct = PuppetAccount(payable(accountModule.predictPuppetAccount(_params(p.user))));
        p.nonce = 0;
    }
}
