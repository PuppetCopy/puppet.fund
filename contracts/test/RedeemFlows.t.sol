// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {V2Base} from "./Base.t.sol";
import {AllocateModule, ALLOCATE_INTENT_TYPEHASH} from "src/hub/AllocateModule.sol";
import {SubscribeModule, SUBSCRIBE_INTENT_TYPEHASH} from "src/hub/SubscribeModule.sol";
import {
    RedeemModule,
    SELL_INTENT_TYPEHASH,
    FULFILL_INTENT_TYPEHASH,
    CLAIM_INTENT_TYPEHASH
} from "src/hub/RedeemModule.sol";
import {RuleLib} from "src/utils/RuleLib.sol";
import {ShareToken} from "src/hub/ShareToken.sol";
import {Error} from "src/utils/Error.sol";

contract RedeemFlowsTest is V2Base {
    function _allocateDigest(
        AllocateModule.AllocateIntent memory _i
    ) internal view returns (bytes32) {
        return _digest(
            hubGateDomain,
            keccak256(
                abi.encode(
                    ALLOCATE_INTENT_TYPEHASH,
                    _i.master,
                    _i.blockNumber,
                    _i.deadline,
                    _i.acceptableRelayFee,
                    _i.nonce,
                    _i.chainId,
                    _i.baseTokenId,
                    _i.name,
                    _i.acceptableNetAssetValue,
                    _i.totalShareSupply,
                    _i.masterAmount,
                    keccak256(abi.encodePacked(_i.puppetList)),
                    keccak256(abi.encodePacked(_i.matchedAmountList))
                )
            )
        );
    }

    // Seed a fund: master stakes 100e6 from its route, gets 100e6 owner shares, fund holds 98e6 base.
    function _seedFund(
        string memory _label
    ) internal returns (Puppet memory master, address fund) {
        master = _makePuppet(_label);
        usdc.mint(accountModule.predictRoute(address(master.acct)), 100e6);
        fund = accountModule.predictFundAccount(address(master.acct));
        AllocateModule.AllocateIntent memory a = AllocateModule.AllocateIntent({
            master: address(master.acct),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 2e6,
            nonce: master.nonce,
            chainId: block.chainid,
            baseTokenId: USDC_ID,
            name: bytes32("Fund"),
            acceptableNetAssetValue: 100e6,
            totalShareSupply: 0,
            masterAmount: 100e6,
            puppetList: new address[](0),
            matchedAmountList: new uint[](0)
        });
        bytes32 ad = _allocateDigest(a);
        hubGate.allocate(a, new bytes[](0), new bytes[](0), _sign(master.key, ad), _sign(attestorKey, ad), 2e6);
        master.nonce = 2;
    }

    function test_subscribe_runs_to_completion() public {
        (, address fund) = _seedFund("M");
        Puppet memory p = _makePuppet("P");
        _seedSignedUsdc(address(p.acct), 100e6);

        RuleLib.Rule[] memory rules = new RuleLib.Rule[](1);
        rules[0] = RuleLib.Rule({fund: fund, body: "", mandate: ""});
        bytes32 ruleHash = keccak256(
            abi.encode(
                keccak256("SubscribeRule(address fund,bytes body,bytes mandate)"),
                rules[0].fund,
                keccak256(rules[0].body),
                keccak256(rules[0].mandate)
            )
        );
        bytes32 rulesHash = keccak256(abi.encodePacked(ruleHash));

        SubscribeModule.SubscribeIntent memory intent = SubscribeModule.SubscribeIntent({
            params: _params(p.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 5e6,
            nonce: p.nonce,
            chainId: block.chainid,
            baseTokenId: USDC_ID,
            rules: rules
        });
        bytes32 d = _digest(
            hubGateDomain,
            keccak256(
                abi.encode(
                    SUBSCRIBE_INTENT_TYPEHASH,
                    _hashAccount(p.user, address(0)),
                    intent.blockNumber,
                    intent.deadline,
                    intent.acceptableRelayFee,
                    intent.nonce,
                    intent.chainId,
                    intent.baseTokenId,
                    rulesHash
                )
            )
        );
        uint feeBefore = usdc.balanceOf(feeReceiver);
        hubGate.subscribe(intent, _sign(p.key, d), _sign(attestorKey, d), 5e6);

        assertEq(usdc.balanceOf(feeReceiver) - feeBefore, 5e6, "subscribe fee from puppet signed base");
        assertEq(p.acct.signedBalanceOf(USDC_ID), 95e6, "puppet signed debited");
    }

    function _buildAllocate(
        Puppet memory master,
        uint nonce,
        uint amount
    ) internal view returns (AllocateModule.AllocateIntent memory a, bytes32 ad) {
        a = AllocateModule.AllocateIntent({
            master: address(master.acct),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: nonce,
            chainId: block.chainid,
            baseTokenId: USDC_ID,
            name: bytes32("Fund"),
            acceptableNetAssetValue: amount,
            totalShareSupply: 0,
            masterAmount: amount,
            puppetList: new address[](0),
            matchedAmountList: new uint[](0)
        });
        ad = _allocateDigest(a);
    }

    function test_sell_fulfill_claim_full_redeem_then_reopen() public {
        (Puppet memory master, address fund) = _seedFund("M");
        ShareToken share = hubGate.predictShareToken(fund, USDC_ID, bytes32("Fund"));
        assertEq(share.totalSupply(), 100e6 * SP, "shares minted at SHARE_PRECISION");

        RedeemModule.SellIntent memory s = RedeemModule.SellIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            baseTokenId: USDC_ID,
            name: bytes32("Fund"),
            master: address(master.acct),
            sharesOut: 100e6 * SP
        });
        bytes32 sd = _digest(
            hubGateDomain,
            keccak256(
                abi.encode(
                    SELL_INTENT_TYPEHASH,
                    _hashAccount(master.user, address(0)),
                    s.blockNumber,
                    s.deadline,
                    s.acceptableRelayFee,
                    s.nonce,
                    s.chainId,
                    s.baseTokenId,
                    s.name,
                    s.master,
                    s.sharesOut
                )
            )
        );
        hubGate.sell(s, _sign(master.key, sd), _sign(attestorKey, sd), 0);
        master.nonce = 3;
        assertEq(share.balanceOf(address(redeemStore)), 100e6 * SP, "shares queued to store");

        RedeemModule.FulfillIntent memory f = RedeemModule.FulfillIntent({
            master: address(master.acct),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            baseTokenId: USDC_ID,
            name: bytes32("Fund"),
            acceptableNetAssetValue: 98e6,
            totalShareSupply: 100e6 * SP,
            acceptableShares: type(uint).max
        });
        bytes32 fd = _digest(
            hubGateDomain,
            keccak256(
                abi.encode(
                    FULFILL_INTENT_TYPEHASH,
                    f.master,
                    f.blockNumber,
                    f.deadline,
                    f.acceptableRelayFee,
                    f.nonce,
                    f.chainId,
                    f.baseTokenId,
                    f.name,
                    f.acceptableNetAssetValue,
                    f.totalShareSupply,
                    f.acceptableShares
                )
            )
        );
        hubGate.fulfill(f, _sign(master.key, fd), _sign(attestorKey, fd), 0);
        master.nonce = 4;
        assertEq(share.totalSupply(), 0, "full unwind retires the entire store-held supply");
        assertEq(usdc.balanceOf(fund), 0, "fund base fully drained at NAV");

        (AllocateModule.AllocateIntent memory ra, bytes32 rad) = _buildAllocate(master, 5, 50e6);
        bytes memory raUser = _sign(master.key, rad);
        bytes memory raAttestor = _sign(attestorKey, rad);
        vm.expectRevert(Error.Share__Empty.selector);
        hubGate.allocate(ra, new bytes[](0), new bytes[](0), raUser, raAttestor, 0);

        uint claimable = redeem.getClaimable(redeemStore, fund, address(master.acct));
        RedeemModule.ClaimIntent memory c = RedeemModule.ClaimIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            baseTokenId: USDC_ID,
            name: bytes32("Fund"),
            master: address(master.acct),
            amount: claimable
        });
        bytes32 cd = _digest(
            hubGateDomain,
            keccak256(
                abi.encode(
                    CLAIM_INTENT_TYPEHASH,
                    _hashAccount(master.user, address(0)),
                    c.blockNumber,
                    c.deadline,
                    c.acceptableRelayFee,
                    c.nonce,
                    c.chainId,
                    c.baseTokenId,
                    c.name,
                    c.master,
                    c.amount
                )
            )
        );
        uint paid = hubGate.claim(c, _sign(master.key, cd), _sign(attestorKey, cd), 0);

        assertEq(claimable, 98e6, "full unwind makes the entire NAV claimable");
        assertEq(paid, claimable, "claim paid full");
        assertEq(usdc.balanceOf(address(master.acct)), claimable, "master received base");
        assertEq(redeemStore.getPool(fund).totalStake, 0, "redeem pool fully drained");

        usdc.mint(accountModule.predictRoute(address(master.acct)), 50e6);
        hubGate.allocate(ra, new bytes[](0), new bytes[](0), raUser, raAttestor, 0);
        assertEq(share.totalSupply(), 50e6 * SP, "reopened fund re-bootstraps at SHARE_PRECISION");
        assertEq(share.balanceOf(address(master.acct)), 50e6 * SP, "fresh owner shares");
        assertEq(usdc.balanceOf(fund), 50e6, "fresh capital at the fund");
    }

    function _sellDigest(
        RedeemModule.SellIntent memory s
    ) internal view returns (bytes32) {
        return _digest(
            hubGateDomain,
            keccak256(
                abi.encode(
                    SELL_INTENT_TYPEHASH,
                    _hashAccount(s.params.user, address(0)),
                    s.blockNumber,
                    s.deadline,
                    s.acceptableRelayFee,
                    s.nonce,
                    s.chainId,
                    s.baseTokenId,
                    s.name,
                    s.master,
                    s.sharesOut
                )
            )
        );
    }

    function _sellIntent(
        Puppet memory holder,
        uint nonce,
        uint sharesOut
    ) internal view returns (RedeemModule.SellIntent memory) {
        return RedeemModule.SellIntent({
            params: _params(holder.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: nonce,
            chainId: block.chainid,
            baseTokenId: USDC_ID,
            name: bytes32("Fund"),
            master: address(holder.acct),
            sharesOut: sharesOut
        });
    }

    function test_sell_flushes_claimable_into_signed() public {
        (Puppet memory master, address fund) = _seedFund("M");

        RedeemModule.SellIntent memory s1 = _sellIntent(master, master.nonce, 40e6 * SP);
        bytes32 s1d = _sellDigest(s1);
        hubGate.sell(s1, _sign(master.key, s1d), _sign(attestorKey, s1d), 0);
        master.nonce = 3;

        RedeemModule.FulfillIntent memory f = RedeemModule.FulfillIntent({
            master: address(master.acct),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            baseTokenId: USDC_ID,
            name: bytes32("Fund"),
            acceptableNetAssetValue: 98e6,
            totalShareSupply: 100e6 * SP,
            acceptableShares: type(uint).max
        });
        bytes32 fd = _digest(
            hubGateDomain,
            keccak256(
                abi.encode(
                    FULFILL_INTENT_TYPEHASH,
                    f.master,
                    f.blockNumber,
                    f.deadline,
                    f.acceptableRelayFee,
                    f.nonce,
                    f.chainId,
                    f.baseTokenId,
                    f.name,
                    f.acceptableNetAssetValue,
                    f.totalShareSupply,
                    f.acceptableShares
                )
            )
        );
        hubGate.fulfill(f, _sign(master.key, fd), _sign(attestorKey, fd), 0);
        master.nonce = 4;

        uint claimable = redeem.getClaimable(redeemStore, fund, address(master.acct));
        assertGt(claimable, 0, "partial fulfill accrued to queued stake");
        assertEq(usdc.balanceOf(address(master.acct)), 0, "nothing paid yet");

        RedeemModule.SellIntent memory s2 = _sellIntent(master, master.nonce, 60e6 * SP);
        bytes32 s2d = _sellDigest(s2);
        hubGate.sell(s2, _sign(master.key, s2d), _sign(attestorKey, s2d), 0);

        assertEq(usdc.balanceOf(address(master.acct)), claimable, "sell flushed claimable to the account");
        assertEq(master.acct.signedBalanceOf(USDC_ID), claimable, "flushed amount is signed");
        assertEq(redeem.getClaimable(redeemStore, fund, address(master.acct)), 0, "accrued reset after flush");
    }
}
