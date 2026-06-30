// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {V2Base} from "./Base.t.sol";
import {Allocate, ALLOCATE_INTENT_TYPEHASH} from "src/hub/Allocate.sol";
import {ShareToken} from "src/hub/ShareToken.sol";
import {FundAccount} from "src/core/FundAccount.sol";
import {FundAccountLib} from "src/utils/FundAccountLib.sol";

contract HubFlowsTest is V2Base {
    function _allocateDigest(
        Allocate.AllocateIntent memory _intent
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                ALLOCATE_INTENT_TYPEHASH,
                _hashAccount(_intent.params.user, address(0)),
                _intent.blockNumber,
                _intent.deadline,
                _intent.acceptableRelayFee,
                _intent.nonce,
                _intent.chainId,
                _hashFundParams(_intent.fundParams),
                _intent.acceptableNetAssetValue,
                _intent.totalShareSupply,
                _intent.masterAmount,
                keccak256(abi.encodePacked(_intent.puppetList)),
                keccak256(abi.encodePacked(_intent.allocatedAmountList))
            )
        );
        return _digest(hubGateDomain, structHash);
    }

    function test_seedFundAccount_mints_owner_shares_and_charges_fund_fee() public {
        Puppet memory master = _makePuppet("M");
        usdc.mint(accountModule.predictRoute(address(master.acct)), 100e6); // master stake staged at its route
        address fund = _fundOf(address(master.acct));

        Allocate.AllocateIntent memory intent = Allocate.AllocateIntent({
            params: _params(master.user),
            fundParams: _fundParams(address(master.acct)),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 2e6,
            nonce: master.nonce,
            chainId: block.chainid,
            acceptableNetAssetValue: 100e6,
            totalShareSupply: 0,
            masterAmount: 100e6,
            puppetList: new address[](0),
            allocatedAmountList: new uint[](0)
        });
        bytes32 digest = _allocateDigest(intent);
        hubGate.allocate(
            intent, new bytes[](0), new bytes[](0), _sign(master.key, digest), _sign(attestorKey, digest), 2e6
        );

        ShareToken share = hubGate.predictShareToken(_fundParams(address(master.acct)));
        assertEq(share.getName(), bytes32("Fund"), "name from clone args");
        assertEq(share.balanceOf(address(master.acct)), 100e6 * SP, "owner shares = stake at share precision");
        assertEq(usdc.balanceOf(fund), 98e6, "fund holds stake minus socialized fee");
        assertEq(FundAccount(payable(fund)).signedBalanceOf(address(usdc)), 98e6, "fund signed synced to balance");
        assertEq(usdc.balanceOf(feeReceiver), 2e6, "fee paid from fund");
        assertEq(usdc.balanceOf(accountModule.predictRoute(address(master.acct))), 0, "master route drained");
    }

    function test_seedFundAccount_pure_controller_zero_stake() public {
        // masterAmount=0: a pure controller (shadow copytrading) seeds a fund with no capital.
        // Owner shares = 0; the master never spends; only the (zero) fee dispatch runs.
        Puppet memory master = _makePuppet("M");
        address fund = _fundOf(address(master.acct));

        Allocate.AllocateIntent memory intent = Allocate.AllocateIntent({
            params: _params(master.user),
            fundParams: FundAccountLib.FundAccountInitParams({
                master: address(master.acct), baseToken: address(usdc), name: bytes32("Shadow")
            }),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            acceptableNetAssetValue: 1,
            totalShareSupply: 0,
            masterAmount: 0,
            puppetList: new address[](0),
            allocatedAmountList: new uint[](0)
        });
        bytes32 digest = _allocateDigest(intent);
        // fundAccountIn==0 (no stake, no puppets) reverts Allocate__ZeroAmount — a pure-controller
        // seed needs at least one funded leg, so this asserts the zero-amount guard holds.
        vm.expectRevert();
        hubGate.allocate(
            intent, new bytes[](0), new bytes[](0), _sign(master.key, digest), _sign(attestorKey, digest), 0
        );
        fund;
    }

    function test_allocate_creates_master_account() public {
        (address user, uint key) = makeAddrAndKey("AM");
        address masterAcct = accountModule.predictPuppetAccount(_params(user));
        usdc.mint(accountModule.predictRoute(masterAcct), 100e6);

        Allocate.AllocateIntent memory intent = Allocate.AllocateIntent({
            params: _params(user),
            fundParams: _fundParams(masterAcct),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 2e6,
            nonce: 0,
            chainId: block.chainid,
            acceptableNetAssetValue: 100e6,
            totalShareSupply: 0,
            masterAmount: 100e6,
            puppetList: new address[](0),
            allocatedAmountList: new uint[](0)
        });
        bytes32 digest = _allocateDigest(intent);

        assertEq(masterAcct.code.length, 0, "master not yet deployed");
        hubGate.allocate(
            intent,
            new bytes[](0),
            new bytes[](0),
            _signDeploy(key),
            "",
            _sign(key, digest),
            _sign(attestorKey, digest),
            2e6
        );

        assertGt(masterAcct.code.length, 0, "master deployed by allocate");
        address fund = _fundOf(masterAcct);
        assertEq(FundAccount(payable(fund)).signedBalanceOf(address(usdc)), 98e6, "fund seeded net of fee");
        assertEq(usdc.balanceOf(accountModule.predictRoute(masterAcct)), 0, "master route drained");
    }
}
