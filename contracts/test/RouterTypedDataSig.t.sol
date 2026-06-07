// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {Test} from "forge-std/src/Test.sol";
import {grantGate} from "./util/grantGate.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {AccountModule} from "src/core/module/AccountModule.sol";
import {Attest} from "src/core/Attest.sol";
import {Dictate} from "src/core/Dictate.sol";
import {TransientRoute} from "src/core/TransientRoute.sol";
import {PuppetAccount} from "src/core/PuppetAccount.sol";
import {MasterAccount} from "src/core/MasterAccount.sol";
import {RegisterModule} from "src/core/module/RegisterModule.sol";
import {WalletDepositModule} from "src/core/module/WalletDepositModule.sol";
import {CoreGate, WITHDRAW_INTENT_TYPEHASH} from "src/core/CoreGate.sol";
import {ACCOUNT_TYPEHASH, AccountLib} from "src/core/AccountLib.sol";
import {Bridge} from "src/utils/Bridge.sol";

import {MockERC20} from "./mock/MockERC20.t.sol";

uint constant HUB_CHAIN_ID = 42_161;

contract RouterTypedDataSigTest is Test {
    bytes32 constant USDC_ID = keccak256("USDC");
    bytes32 constant ACCOUNT_TYPESTRING_HASH =
        keccak256("AccountInitParams(address user,bytes32 name,bytes32 baseTokenId,address signer)");

    address owner = makeAddr("Owner");
    address attestor;
    uint attestorKey;
    address user;
    uint userKey;
    address feeReceiver = makeAddr("FeeReceiver");

    MockERC20 usdc;
    Dictate dictate;
    AccountModule accountGate;
    RegisterModule register;
    CoreGate router;
    bytes32 domainSeparator;
    PuppetAccount puppet;

    function setUp() public {
        vm.chainId(HUB_CHAIN_ID);
        (attestor, attestorKey) = makeAddrAndKey("Attestor");
        (user, userKey) = makeAddrAndKey("User");

        vm.startPrank(owner);

        usdc = new MockERC20("USDC", "USDC", 6);
        dictate = new Dictate(owner);

        register = new RegisterModule(dictate, HUB_CHAIN_ID);

        PuppetAccount accountImpl = new PuppetAccount();
        TransientRoute depositPuppetAccount = new TransientRoute();
        MasterAccount masterPuppetAccount = new MasterAccount();
        Attest attest = new Attest(dictate);
        accountGate = new AccountModule(
            dictate, attest, address(accountImpl), address(depositPuppetAccount), address(masterPuppetAccount)
        );
        dictate.setAccess(attest, address(accountGate));

        WalletDepositModule walletDeposit = new WalletDepositModule(dictate);

        Bridge bridge = new Bridge(address(0), bytes32(0));

        router = new CoreGate(
            dictate,
            accountGate,
            walletDeposit,
            register,
            bridge,
            HUB_CHAIN_ID,
            CoreGate.Config({
                attestor: attestor,
                feeReceiver: feeReceiver,
                transferGasLimit: 200_000,
                maxBlockDelay: 5,
                maxRelayFeeBps: 1000
            })
        );

        dictate.setAccess(walletDeposit, address(router));
        grantGate(dictate, accountGate, address(router));
        grantGate(dictate, accountGate, address(this));

        dictate.setAccess(register, owner);
        register.registerToken(USDC_ID, IERC20(address(usdc)), 0, address(usdc));

        vm.stopPrank();

        domainSeparator = _routerDomainSeparator();
        puppet = _deployPuppet();
    }

    function test_transferOut_through_router_with_walletStyle_typedData_signature() public {
        usdc.mint(address(puppet), 100e6);
        vm.store(address(puppet), bytes32(uint(0)), bytes32(uint(100e6)));

        CoreGate.WithdrawIntent memory intent = CoreGate.WithdrawIntent({
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            params: _params(),
            amount: 100e6,
            acceptableRelayFee: 1e6,
            nonce: 0,
            chainId: block.chainid
        });

        bytes32 digest = _walletStyleDigest(intent);
        bytes memory userSig = _sign(userKey, digest);
        bytes memory attSig = _sign(attestorKey, digest);

        router.walletWithdraw(intent, userSig, attSig, intent.acceptableRelayFee);

        assertEq(usdc.balanceOf(user), 99e6);
        assertEq(usdc.balanceOf(feeReceiver), 1e6);
    }

    function test_ACCOUNT_TYPEHASH_matches_canonical_typestring() public pure {
        assertEq(ACCOUNT_TYPEHASH, ACCOUNT_TYPESTRING_HASH);
    }

    function _walletStyleDigest(
        CoreGate.WithdrawIntent memory _intent
    ) internal view returns (bytes32) {
        bytes32 _accountHash = keccak256(
            abi.encode(
                ACCOUNT_TYPESTRING_HASH,
                _intent.params.user,
                _intent.params.name,
                _intent.params.baseTokenId,
                _intent.params.signer
            )
        );
        bytes32 _structHash = keccak256(
            abi.encode(
                WITHDRAW_INTENT_TYPEHASH,
                _accountHash,
                _intent.blockNumber,
                _intent.deadline,
                _intent.acceptableRelayFee,
                _intent.nonce,
                _intent.chainId,
                _intent.amount
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, _structHash));
    }

    function _routerDomainSeparator() internal view returns (bytes32) {
        bytes32 _typeHash =
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
        return keccak256(
            abi.encode(_typeHash, keccak256(bytes("CoreGate")), keccak256(bytes("1")), block.chainid, address(router))
        );
    }

    function _params() internal view returns (AccountLib.AccountInitParams memory) {
        return AccountLib.AccountInitParams({
            user: user, name: bytes32("PuppetName"), baseTokenId: USDC_ID, signer: address(0)
        });
    }

    function _deployPuppet() internal returns (PuppetAccount) {
        AccountLib.AccountInitParams memory p = _params();
        bytes memory _msg = bytes("Puppet: Authorize session key");
        bytes32 _bind = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n", vm.toString(_msg.length), _msg));
        vm.startPrank(owner);
        grantGate(dictate, accountGate, address(this));
        vm.stopPrank();
        accountGate.createPuppetAccount(p, _sign(userKey, _bind), "");
        return PuppetAccount(payable(accountGate.predictPuppetAccount(p)));
    }

    function _sign(
        uint _key,
        bytes32 _digest
    ) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_key, _digest);
        return abi.encodePacked(r, s, v);
    }
}
