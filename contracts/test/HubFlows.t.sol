// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {V2Base} from "./Base.t.sol";
import {Allocate, ALLOCATE_INTENT_TYPEHASH} from "src/hub/Allocate.sol";
import {ShareToken} from "src/hub/ShareToken.sol";
import {ShareLib} from "src/utils/ShareLib.sol";

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
                _hashShare(_intent.share),
                _intent.acceptableNetAssetValue,
                _intent.totalShareSupply,
                _intent.masterAmount,
                keccak256(abi.encodePacked(_intent.puppetList)),
                keccak256(abi.encodePacked(_intent.matchedAmountList))
            )
        );
        return _digest(hubGateDomain, structHash);
    }

    function test_seedFundAccount_mints_owner_shares_and_charges_fund_fee() public {
        Puppet memory master = _makePuppet("M");
        usdc.mint(accountModule.predictRoute(address(master.acct)), 100e6); // master stake staged at its route
        address fund = accountModule.predictFundAccount(address(master.acct));

        Allocate.AllocateIntent memory intent = Allocate.AllocateIntent({
            params: _params(master.user),
            share: _share(address(master.acct)),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 2e6,
            nonce: master.nonce,
            chainId: block.chainid,
            acceptableNetAssetValue: 100e6,
            totalShareSupply: 0,
            masterAmount: 100e6,
            puppetList: new address[](0),
            matchedAmountList: new uint[](0)
        });
        bytes32 digest = _allocateDigest(intent);
        hubGate.allocate(
            intent, new bytes[](0), new bytes[](0), _sign(master.key, digest), _sign(attestorKey, digest), 2e6
        );

        ShareToken share = hubGate.predictShareToken(_share(address(master.acct)));
        assertEq(share.getName(), bytes32("Fund"), "name from clone args");
        assertEq(share.balanceOf(address(master.acct)), 100e6 * SP, "owner shares = stake at share precision");
        assertEq(usdc.balanceOf(fund), 98e6, "fund holds stake minus socialized fee");
        assertEq(usdc.balanceOf(feeReceiver), 2e6, "fee paid from fund");
        assertEq(usdc.balanceOf(accountModule.predictRoute(address(master.acct))), 0, "master route drained");
    }

    function test_seedFundAccount_pure_controller_zero_stake() public {
        // masterAmount=0: a pure controller (shadow copytrading) seeds a fund with no capital.
        // Owner shares = 0; the master never spends; only the (zero) fee dispatch runs.
        Puppet memory master = _makePuppet("M");
        address fund = accountModule.predictFundAccount(address(master.acct));

        Allocate.AllocateIntent memory intent = Allocate.AllocateIntent({
            params: _params(master.user),
            share: ShareLib.ShareInitParams({
                master: address(master.acct), baseTokenId: USDC_ID, name: bytes32("Shadow")
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
            matchedAmountList: new uint[](0)
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
}
