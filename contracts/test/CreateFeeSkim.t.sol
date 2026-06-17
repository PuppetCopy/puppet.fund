// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {V2Base} from "./Base.t.sol";
import {Account as AccountContract, CREATE_PUPPET_ACCOUNT_INTENT_TYPEHASH} from "src/core/Account.sol";
import {PuppetAccount} from "src/core/PuppetAccount.sol";
import {Error} from "src/utils/Error.sol";

contract CreateFeeSkimTest is V2Base {
    function _puppetCreate(
        address _user,
        uint _fee,
        uint _deposit
    ) internal view returns (bytes32 digest, AccountContract.CreatePuppetAccountIntent memory intent) {
        intent = AccountContract.CreatePuppetAccountIntent({
            params: _params(_user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: _fee,
            nonce: 0,
            chainId: block.chainid,
            tokenId: USDC_ID,
            initialDepositAmount: _deposit
        });
        bytes32 structHash = keccak256(
            abi.encode(
                CREATE_PUPPET_ACCOUNT_INTENT_TYPEHASH,
                _hashAccount(_user, address(0)),
                intent.blockNumber,
                intent.deadline,
                intent.acceptableRelayFee,
                intent.nonce,
                intent.chainId,
                intent.tokenId,
                intent.initialDepositAmount
            )
        );
        digest = _digest(accountGateDomain, structHash);
    }

    function test_createPuppetAccount_zeroDeposit_skims_fee_and_leaves_principal_on_route() public {
        (address user, uint key) = makeAddrAndKey("Skim");
        address route = accountModule.predictRoute(accountModule.predictPuppetAccount(_params(user)));
        usdc.mint(route, 100e6);

        (bytes32 digest, AccountContract.CreatePuppetAccountIntent memory intent) = _puppetCreate(user, 5e6, 0);
        accountGate.createPuppetAccount(
            intent, _signDeploy(key), "", _sign(key, digest), _sign(attestorKey, digest), 5e6
        );

        PuppetAccount acct = PuppetAccount(payable(accountModule.predictPuppetAccount(_params(user))));
        assertEq(usdc.balanceOf(feeReceiver), 5e6, "deploy fee skimmed to feeReceiver");
        assertEq(usdc.balanceOf(route), 95e6, "principal stays on route for the downstream sweep");
        assertEq(usdc.balanceOf(address(acct)), 0, "account holds nothing at create");
        assertEq(acct.signedBalanceOf(USDC_ID), 0, "no signed credit on a zero-deposit create");
    }

    function test_createPuppetAccount_zeroDeposit_ratioCap_reverts() public {
        (address user, uint key) = makeAddrAndKey("Cap");
        address route = accountModule.predictRoute(accountModule.predictPuppetAccount(_params(user)));
        usdc.mint(route, 100e6);

        (bytes32 digest, AccountContract.CreatePuppetAccountIntent memory intent) = _puppetCreate(user, 25e6, 0);
        vm.expectRevert(abi.encodeWithSelector(Error.Intent__RelayFeeRatioExceeded.selector, 25e6, 100e6, 2000));
        accountGate.createPuppetAccount(
            intent, _signDeploy(key), "", _sign(key, digest), _sign(attestorKey, digest), 25e6
        );
    }

    function test_createPuppetAccount_funded_still_credits_net_of_fee() public {
        (address user, uint key) = makeAddrAndKey("Funded");
        address route = accountModule.predictRoute(accountModule.predictPuppetAccount(_params(user)));
        usdc.mint(route, 100e6);

        (bytes32 digest, AccountContract.CreatePuppetAccountIntent memory intent) = _puppetCreate(user, 5e6, 100e6);
        accountGate.createPuppetAccount(
            intent, _signDeploy(key), "", _sign(key, digest), _sign(attestorKey, digest), 5e6
        );

        PuppetAccount acct = PuppetAccount(payable(accountModule.predictPuppetAccount(_params(user))));
        assertEq(usdc.balanceOf(feeReceiver), 5e6, "fee from deposit");
        assertEq(usdc.balanceOf(route), 0, "deposit swept off route");
        assertEq(usdc.balanceOf(address(acct)), 95e6, "account holds deposit minus fee");
        assertEq(acct.signedBalanceOf(USDC_ID), 95e6, "signed credited net of fee");
    }
}
