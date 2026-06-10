// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {V2Base} from "./Base.t.sol";
import {AccountGate, RECOGNIZE_INTENT_TYPEHASH} from "src/AccountGate.sol";
import {HubGate, WITHDRAW_TO_WALLET_INTENT_TYPEHASH} from "src/HubGate.sol";
import {Error} from "src/utils/Error.sol";

contract DepositHotPathTest is V2Base {
    function test_createPuppetAccount_deploys() public {
        Puppet memory p = _makePuppet("P");
        assertGt(address(p.acct).code.length, 0, "puppet deployed");
        assertEq(p.acct.getUser(), p.user, "user arg");
    }

    function _withdraw(
        Puppet memory p,
        uint amount,
        uint fee
    ) internal view returns (bytes32 digest, HubGate.WithdrawToWalletIntent memory intent) {
        intent = HubGate.WithdrawToWalletIntent({
            params: _params(p.user),
            blockNumber: block.number,
            deadline: block.timestamp + 1,
            acceptableRelayFee: fee,
            nonce: p.nonce,
            chainId: block.chainid,
            tokenId: USDC_ID,
            amount: amount
        });
        bytes32 structHash = keccak256(
            abi.encode(
                WITHDRAW_TO_WALLET_INTENT_TYPEHASH,
                _hashAccount(p.user, address(0)),
                intent.blockNumber,
                intent.deadline,
                intent.acceptableRelayFee,
                intent.nonce,
                intent.chainId,
                intent.tokenId,
                intent.amount
            )
        );
        digest = _digest(hubGateDomain, structHash);
    }

    function test_withdrawToWallet_pays_amount_minus_fee() public {
        Puppet memory p = _makePuppet("P");
        _seedSignedUsdc(address(p.acct), 150e6);
        (bytes32 digest, HubGate.WithdrawToWalletIntent memory intent) = _withdraw(p, 150e6, 5e6);
        hubGate.withdrawToWallet(intent, _sign(p.key, digest), _sign(attestorKey, digest), 5e6);
        assertEq(usdc.balanceOf(p.user), 145e6, "receiver gets amount minus fee");
        assertEq(usdc.balanceOf(feeReceiver), 5e6, "relayer fee");
        assertEq(usdc.balanceOf(address(p.acct)), 0, "no dust");
        assertEq(p.acct.signedBalanceOf(USDC_ID), 0, "signed zeroed");
    }

    function test_withdrawToWallet_zero_reverts() public {
        Puppet memory p = _makePuppet("P");
        _seedSignedUsdc(address(p.acct), 100e6);
        (bytes32 digest, HubGate.WithdrawToWalletIntent memory intent) = _withdraw(p, 0, 1e6);
        vm.expectRevert(Error.Deposit__NothingToWithdraw.selector);
        hubGate.withdrawToWallet(intent, _sign(p.key, digest), _sign(attestorKey, digest), 1e6);
    }

    function test_withdrawToWallet_insufficient_signed_reverts() public {
        Puppet memory p = _makePuppet("P");
        _seedSignedUsdc(address(p.acct), 5e6);
        (bytes32 digest, HubGate.WithdrawToWalletIntent memory intent) = _withdraw(p, 10e6, 1e6);
        vm.expectRevert(abi.encodeWithSelector(Error.Deposit__InsufficientBalance.selector, 5e6, 10e6));
        hubGate.withdrawToWallet(intent, _sign(p.key, digest), _sign(attestorKey, digest), 1e6);
    }

    function test_withdrawToWallet_nonce_reuse_reverts() public {
        Puppet memory p = _makePuppet("P");
        _seedSignedUsdc(address(p.acct), 150e6);
        (bytes32 digest, HubGate.WithdrawToWalletIntent memory intent) = _withdraw(p, 10e6, 0);
        hubGate.withdrawToWallet(intent, _sign(p.key, digest), _sign(attestorKey, digest), 0);
        _seedSignedUsdc(address(p.acct), 150e6);
        vm.expectRevert();
        hubGate.withdrawToWallet(intent, _sign(p.key, digest), _sign(attestorKey, digest), 0);
    }

    function test_recognize_sweeps_route_and_credits_signed() public {
        Puppet memory p = _makePuppet("P");
        address route = accountModule.predictRoute(address(p.acct));
        usdc.mint(route, 100e6);

        AccountGate.RecognizeIntent memory intent = AccountGate.RecognizeIntent({
            params: _params(p.user),
            blockNumber: block.number,
            deadline: block.timestamp + 1,
            acceptableRelayFee: 2e6,
            nonce: p.nonce,
            chainId: block.chainid,
            tokenId: USDC_ID,
            amount: 100e6
        });
        bytes32 structHash = keccak256(
            abi.encode(
                RECOGNIZE_INTENT_TYPEHASH,
                _hashAccount(p.user, address(0)),
                intent.blockNumber,
                intent.deadline,
                intent.acceptableRelayFee,
                intent.nonce,
                intent.chainId,
                intent.tokenId,
                intent.amount
            )
        );
        bytes32 digest = _digest(accountGateDomain, structHash);
        accountGate.recognize(intent, _sign(p.key, digest), _sign(attestorKey, digest), 2e6);

        assertEq(p.acct.signedBalanceOf(USDC_ID), 98e6, "signed credited net of fee");
        assertEq(usdc.balanceOf(address(p.acct)), 98e6, "account holds net");
        assertEq(usdc.balanceOf(feeReceiver), 2e6, "fee");
        assertEq(usdc.balanceOf(route), 0, "route swept");
    }

    function test_deposit_funds_the_route() public {
        Puppet memory p = _makePuppet("P");
        address depositor = makeAddr("Depositor");
        usdc.mint(depositor, 50e6);
        vm.prank(depositor);
        usdc.approve(address(walletDeposit), 50e6);
        vm.prank(depositor);
        accountGate.deposit(_params(p.user), USDC_ID, 50e6);
        assertEq(usdc.balanceOf(accountModule.predictRoute(address(p.acct))), 50e6, "route funded");
    }
}
