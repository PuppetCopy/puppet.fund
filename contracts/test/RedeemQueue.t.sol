// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {V2Base} from "./Base.t.sol";
import {Allocate, ALLOCATE_INTENT_TYPEHASH} from "src/hub/Allocate.sol";
import {Subscribe, SUBSCRIBE_INTENT_TYPEHASH} from "src/hub/Subscribe.sol";
import {
    Redeem,
    SELL_INTENT_TYPEHASH,
    REDEEM_INTENT_TYPEHASH,
    CLAIM_INTENT_TYPEHASH,
    LIQUIDATE_INTENT_TYPEHASH
} from "src/hub/Redeem.sol";
import {RuleLib, MANDATE_TYPEHASH} from "src/utils/RuleLib.sol";
import {ShareToken} from "src/hub/ShareToken.sol";
import {Error} from "src/utils/Error.sol";

contract RedeemQueueTest is V2Base {
    function _allocateDigest(
        Allocate.AllocateIntent memory _i
    ) internal view returns (bytes32) {
        return _digest(
            hubGateDomain,
            keccak256(
                abi.encode(
                    ALLOCATE_INTENT_TYPEHASH,
                    _hashAccount(_i.params.user, address(0)),
                    _i.blockNumber,
                    _i.deadline,
                    _i.acceptableRelayFee,
                    _i.nonce,
                    _i.chainId,
                    _hashShare(_i.share),
                    _i.acceptableNetAssetValue,
                    _i.totalShareSupply,
                    _i.masterAmount,
                    keccak256(abi.encodePacked(_i.puppetList)),
                    keccak256(abi.encodePacked(_i.matchedAmountList))
                )
            )
        );
    }

    function _redeemDigest(
        Redeem.RedeemIntent memory f
    ) internal view returns (bytes32) {
        return _digest(
            hubGateDomain,
            keccak256(
                abi.encode(
                    REDEEM_INTENT_TYPEHASH,
                    _hashAccount(f.params.user, address(0)),
                    f.blockNumber,
                    f.deadline,
                    f.acceptableRelayFee,
                    f.nonce,
                    f.chainId,
                    _hashShare(f.share),
                    f.sharesOut,
                    f.assetsOut,
                    f.acceptableNetAssetValue
                )
            )
        );
    }

    function _sellDigest(
        Redeem.SellIntent memory _s
    ) internal view returns (bytes32) {
        return _digest(
            hubGateDomain,
            keccak256(
                abi.encode(
                    SELL_INTENT_TYPEHASH,
                    _hashAccount(_s.params.user, address(0)),
                    _s.blockNumber,
                    _s.deadline,
                    _s.acceptableRelayFee,
                    _s.nonce,
                    _s.chainId,
                    _hashShare(_s.share),
                    _s.sharesOut
                )
            )
        );
    }

    function _claimDigest(
        Redeem.ClaimIntent memory c
    ) internal view returns (bytes32) {
        return _digest(
            hubGateDomain,
            keccak256(
                abi.encode(
                    CLAIM_INTENT_TYPEHASH,
                    _hashAccount(c.params.user, address(0)),
                    c.blockNumber,
                    c.deadline,
                    c.acceptableRelayFee,
                    c.nonce,
                    c.chainId,
                    _hashShare(c.share),
                    c.amount
                )
            )
        );
    }

    function _liquidateDigest(
        Redeem.LiquidateIntent memory c
    ) internal view returns (bytes32) {
        return _digest(
            hubGateDomain,
            keccak256(
                abi.encode(
                    LIQUIDATE_INTENT_TYPEHASH,
                    _hashAccount(c.params.user, address(0)),
                    c.blockNumber,
                    c.deadline,
                    c.acceptableRelayFee,
                    c.nonce,
                    c.chainId,
                    _hashShare(c.share),
                    c.acceptableNetAssetValue
                )
            )
        );
    }

    function _sellIntent(
        Puppet memory _holder,
        address _master,
        uint _sharesOut
    ) internal view returns (Redeem.SellIntent memory) {
        return Redeem.SellIntent({
            params: _params(_holder.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: _holder.nonce,
            chainId: block.chainid,
            share: _share(_master),
            sharesOut: _sharesOut
        });
    }

    function _setupFund(
        string memory _masterLabel,
        string memory _puppetLabel,
        uint _masterAmount,
        uint _puppetSeed,
        uint _matched
    ) internal returns (Puppet memory master, Puppet memory p, address fund, ShareToken share) {
        master = _makePuppet(_masterLabel);
        p = _makePuppet(_puppetLabel);
        _seedSignedUsdc(address(p.acct), _puppetSeed);
        fund = accountModule.predictFundAccount(address(master.acct));
        usdc.mint(accountModule.predictRoute(address(master.acct)), _masterAmount);

        bytes memory body = hex"01";
        RuleLib.Rule[] memory rules = new RuleLib.Rule[](1);
        bytes32 mandateDigest = _digest(
            hubGateDomain,
            keccak256(abi.encode(MANDATE_TYPEHASH, address(p.acct), fund, address(usdc), keccak256(body)))
        );
        bytes memory mandateSig = _sign(p.key, mandateDigest);
        rules[0] = RuleLib.Rule({fund: fund, body: body, mandate: mandateSig});
        bytes32 ruleHash = keccak256(
            abi.encode(
                keccak256("SubscribeRule(address fund,bytes body,bytes mandate)"),
                rules[0].fund,
                keccak256(rules[0].body),
                keccak256(rules[0].mandate)
            )
        );
        Subscribe.SubscribeIntent memory sub = Subscribe.SubscribeIntent({
            params: _params(p.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: p.nonce,
            chainId: block.chainid,
            baseTokenId: USDC_ID,
            rules: rules
        });
        bytes32 subD = _digest(
            hubGateDomain,
            keccak256(
                abi.encode(
                    SUBSCRIBE_INTENT_TYPEHASH,
                    _hashAccount(p.user, address(0)),
                    sub.blockNumber,
                    sub.deadline,
                    sub.acceptableRelayFee,
                    sub.nonce,
                    sub.chainId,
                    sub.baseTokenId,
                    keccak256(abi.encodePacked(ruleHash))
                )
            )
        );
        hubGate.subscribe(sub, _sign(p.key, subD), _sign(attestorKey, subD), 0);
        p.nonce = 2;

        address[] memory puppetList = new address[](1);
        puppetList[0] = address(p.acct);
        uint[] memory matchedList = new uint[](1);
        matchedList[0] = _matched;
        bytes[] memory bodyList = new bytes[](1);
        bodyList[0] = body;
        bytes[] memory mandateList = new bytes[](1);
        mandateList[0] = mandateSig;

        Allocate.AllocateIntent memory a = Allocate.AllocateIntent({
            params: _params(master.user),
            share: _share(address(master.acct)),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 2e6,
            nonce: master.nonce,
            chainId: block.chainid,
            acceptableNetAssetValue: 100e6,
            totalShareSupply: 0,
            masterAmount: _masterAmount,
            puppetList: puppetList,
            matchedAmountList: matchedList
        });
        bytes32 ad = _allocateDigest(a);
        hubGate.allocate(a, bodyList, mandateList, _sign(master.key, ad), _sign(attestorKey, ad), 2e6);
        master.nonce = 2;

        share = hubGate.predictShareToken(_share(address(master.acct)));
    }

    function test_dust_stake_dies_at_rotation_fund_reopens() public {
        (Puppet memory master, Puppet memory p, address fund, ShareToken share) =
            _setupFund("M", "P", 100e6, 10e6, 1);
        assertEq(share.balanceOf(address(p.acct)), 1 * SP, "puppet got 1e12 shares for 1 wei");
        assertEq(usdc.balanceOf(fund), 98e6 + 1, "fund base after fee");

        Redeem.SellIntent memory sp = _sellIntent(p, address(master.acct), 1 * SP);
        bytes32 spd = _sellDigest(sp);
        hubGate.sell(sp, _sign(p.key, spd), _sign(attestorKey, spd), 0);
        p.nonce = 3;

        Redeem.RedeemIntent memory f = Redeem.RedeemIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            share: _share(address(master.acct)),
            sharesOut: 100e6 * SP,
            assetsOut: 98e6 + 1,
            acceptableNetAssetValue: 98e6 + 1
        });
        bytes32 fd = _redeemDigest(f);
        hubGate.redeem(f, _sign(master.key, fd), _sign(attestorKey, fd), 0);
        master.nonce = 3;

        assertEq(share.totalSupply(), 0, "full retire");
        assertApproxEqAbs(usdc.balanceOf(address(master.acct)), 98e6 + 1, 2, "master floor payout signed in");
        assertEq(redeemStore.getPosition(fund, address(master.acct)).stake, 0, "master settled in the same intent");
        assertEq(redeemStore.getPool(fund).epoch, 1, "full retire rotated the pool");
        assertEq(redeemStore.getPool(fund).totalStake, 0, "rotation drops the dust stake");

        Redeem.SellIntent memory sBlocked = _sellIntent(master, address(master.acct), 1);
        bytes32 sbd = _sellDigest(sBlocked);
        bytes memory sbu = _sign(master.key, sbd);
        bytes memory sba = _sign(attestorKey, sbd);
        vm.expectRevert(Error.Share__MasterCannotSell.selector);
        hubGate.sell(sBlocked, sbu, sba, 0);

        assertEq(redeem.getClaimable(redeemStore, fund, address(p.acct)), 0, "dust entitlement floors to zero");
        assertEq(redeem.getClaimable(redeemStore, fund, address(master.acct)), 0, "master fully settled");

        Redeem.ClaimIntent memory cp = Redeem.ClaimIntent({
            params: _params(p.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: p.nonce,
            chainId: block.chainid,
            share: _share(address(master.acct)),
            amount: 1
        });
        bytes32 cpd = _claimDigest(cp);
        bytes memory cpu = _sign(p.key, cpd);
        bytes memory cpa = _sign(attestorKey, cpd);
        vm.expectRevert(Error.Share__InsufficientClaimable.selector);
        hubGate.claim(cp, cpu, cpa, 0);

        usdc.mint(accountModule.predictRoute(address(master.acct)), 50e6);
        Allocate.AllocateIntent memory ra = Allocate.AllocateIntent({
            params: _params(master.user),
            share: _share(address(master.acct)),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            acceptableNetAssetValue: 50e6,
            totalShareSupply: 0,
            masterAmount: 50e6,
            puppetList: new address[](0),
            matchedAmountList: new uint[](0)
        });
        bytes32 rad = _allocateDigest(ra);
        hubGate.allocate(ra, new bytes[](0), new bytes[](0), _sign(master.key, rad), _sign(attestorKey, rad), 0);
        assertEq(share.totalSupply(), 50e6 * SP, "dust sleeper no longer bricks the reopen");

        emit log_named_uint("stranded store base", usdc.balanceOf(address(redeemStore)));
    }

    function test_clean_two_holder_unwind_reopens() public {
        (Puppet memory master, Puppet memory p, address fund, ShareToken share) =
            _setupFund("M2", "P2", 60e6, 50e6, 40e6);
        assertEq(usdc.balanceOf(fund), 98e6, "fund base after fee");

        Redeem.SellIntent memory sp = _sellIntent(p, address(master.acct), 20e6 * SP);
        bytes32 spd = _sellDigest(sp);
        hubGate.sell(sp, _sign(p.key, spd), _sign(attestorKey, spd), 0);
        p.nonce = 3;

        Redeem.RedeemIntent memory f1 = Redeem.RedeemIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            share: _share(address(master.acct)),
            sharesOut: 0,
            assetsOut: 500e5,
            acceptableNetAssetValue: 98e6
        });
        bytes32 fxd = _redeemDigest(f1);
        bytes memory fxu = _sign(master.key, fxd);
        bytes memory fxa = _sign(attestorKey, fxd);
        vm.expectRevert(Error.Redeem__DrainExceedsQueue.selector);
        hubGate.redeem(f1, fxu, fxa, 0);

        f1.assetsOut = 196e5;
        bytes32 f1d = _redeemDigest(f1);
        hubGate.redeem(f1, _sign(master.key, f1d), _sign(attestorKey, f1d), 0);
        master.nonce = 3;
        assertEq(usdc.balanceOf(address(master.acct)), 0, "no master position, claim cap pays nothing");

        uint claimableP1 = redeem.getClaimable(redeemStore, fund, address(p.acct));
        assertGt(claimableP1, 0, "maintenance drain advanced accruedPerStake for the queued puppet");

        uint pBalBefore = usdc.balanceOf(address(p.acct));
        uint pSignedBefore = p.acct.signedBalanceOf(USDC_ID);
        Redeem.SellIntent memory sp2 = _sellIntent(p, address(master.acct), 20e6 * SP);
        bytes32 sp2d = _sellDigest(sp2);
        hubGate.sell(sp2, _sign(p.key, sp2d), _sign(attestorKey, sp2d), 0);
        p.nonce = 4;
        assertEq(usdc.balanceOf(address(p.acct)) - pBalBefore, claimableP1, "sell flushed claimable to the account");
        assertEq(p.acct.signedBalanceOf(USDC_ID) - pSignedBefore, claimableP1, "flushed amount is signed");

        Redeem.RedeemIntent memory f2 = Redeem.RedeemIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            share: _share(address(master.acct)),
            sharesOut: 60e6 * SP,
            assetsOut: usdc.balanceOf(fund),
            acceptableNetAssetValue: usdc.balanceOf(fund)
        });
        bytes32 f2d = _redeemDigest(f2);
        hubGate.redeem(f2, _sign(master.key, f2d), _sign(attestorKey, f2d), 0);
        master.nonce = 4;

        uint masterPaid = usdc.balanceOf(address(master.acct));
        assertGt(masterPaid, 0, "master exit proceeds signed onto the account");
        assertEq(share.totalSupply(), 0, "full retire");
        assertEq(redeemStore.getPosition(fund, address(master.acct)).stake, 0, "master settled in the same intent");

        uint claimableP2 = redeem.getClaimable(redeemStore, fund, address(p.acct));
        Redeem.ClaimIntent memory cp = Redeem.ClaimIntent({
            params: _params(p.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: p.nonce,
            chainId: block.chainid,
            share: _share(address(master.acct)),
            amount: claimableP2
        });
        bytes32 cpd = _claimDigest(cp);
        hubGate.claim(cp, _sign(p.key, cpd), _sign(attestorKey, cpd), 0);
        p.nonce = 5;

        assertEq(redeemStore.getPool(fund).totalStake, 0, "clean unwind drains stake");
        uint stranded = usdc.balanceOf(address(redeemStore));
        emit log_named_uint("stranded store base", stranded);
        assertEq(masterPaid + claimableP1 + claimableP2 + stranded, 98e6, "every base unit accounted for");

        usdc.mint(accountModule.predictRoute(address(master.acct)), 50e6);
        Allocate.AllocateIntent memory ra = Allocate.AllocateIntent({
            params: _params(master.user),
            share: _share(address(master.acct)),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            acceptableNetAssetValue: 50e6,
            totalShareSupply: 0,
            masterAmount: 50e6,
            puppetList: new address[](0),
            matchedAmountList: new uint[](0)
        });
        bytes32 rad = _allocateDigest(ra);
        hubGate.allocate(ra, new bytes[](0), new bytes[](0), _sign(master.key, rad), _sign(attestorKey, rad), 0);
        assertEq(share.totalSupply(), 50e6 * SP, "reopen bootstraps");
    }

    function test_sleeper_settles_only_against_its_own_epoch() public {
        (Puppet memory master, Puppet memory p, address fund, ShareToken share) =
            _setupFund("M3", "P3", 60e6, 50e6, 40e6);

        Redeem.SellIntent memory sp = _sellIntent(p, address(master.acct), 40e6 * SP);
        bytes32 spd = _sellDigest(sp);
        hubGate.sell(sp, _sign(p.key, spd), _sign(attestorKey, spd), 0);
        p.nonce = 3;

        Redeem.RedeemIntent memory f1 = Redeem.RedeemIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            share: _share(address(master.acct)),
            sharesOut: 0,
            assetsOut: 392e5,
            acceptableNetAssetValue: 98e6
        });
        bytes32 f1d = _redeemDigest(f1);
        hubGate.redeem(f1, _sign(master.key, f1d), _sign(attestorKey, f1d), 0);
        master.nonce = 3;
        assertEq(redeemStore.getPool(fund).epoch, 1, "first wipeout rotated");

        Redeem.RedeemIntent memory f2 = Redeem.RedeemIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            share: _share(address(master.acct)),
            sharesOut: 60e6 * SP,
            assetsOut: 30e6,
            acceptableNetAssetValue: 30e6
        });
        bytes32 f2d = _redeemDigest(f2);
        hubGate.redeem(f2, _sign(master.key, f2d), _sign(attestorKey, f2d), 0);
        master.nonce = 4;
        assertEq(redeemStore.getPool(fund).epoch, 2, "second wipeout rotated");
        assertEq(usdc.balanceOf(address(master.acct)), 30e6, "master exited at the marked-down NAV");

        uint claimableP = redeem.getClaimable(redeemStore, fund, address(p.acct));
        assertEq(claimableP, 39200000, "sleeper settles against its own epoch's closing rate, not later ones");

        Redeem.ClaimIntent memory cp = Redeem.ClaimIntent({
            params: _params(p.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: p.nonce,
            chainId: block.chainid,
            share: _share(address(master.acct)),
            amount: claimableP
        });
        bytes32 cpd = _claimDigest(cp);
        hubGate.claim(cp, _sign(p.key, cpd), _sign(attestorKey, cpd), 0);

        assertEq(usdc.balanceOf(address(redeemStore)), 0, "store fully attributed across epochs");
        assertEq(redeem.getClaimable(redeemStore, fund, address(p.acct)), 0, "sleeper settled");
    }

    function test_master_cannot_extract_past_his_fraction() public {
        (Puppet memory master, Puppet memory p, address fund, ShareToken share) =
            _setupFund("M4", "P4", 60e6, 50e6, 40e6);

        Redeem.RedeemIntent memory f = Redeem.RedeemIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            share: _share(address(master.acct)),
            sharesOut: 60e6 * SP,
            assetsOut: 49e6,
            acceptableNetAssetValue: 98e6
        });
        bytes32 fd = _redeemDigest(f);
        bytes memory fu = _sign(master.key, fd);
        bytes memory fa = _sign(attestorKey, fd);
        vm.expectRevert(Error.Redeem__MasterFractionDecreased.selector);
        hubGate.redeem(f, fu, fa, 0);

        Redeem.SellIntent memory sp = _sellIntent(p, address(master.acct), 20e6 * SP);
        bytes32 spd = _sellDigest(sp);
        hubGate.sell(sp, _sign(p.key, spd), _sign(attestorKey, spd), 0);
        p.nonce = 3;

        f.sharesOut = 30e6 * SP + 1e12;
        fd = _redeemDigest(f);
        fu = _sign(master.key, fd);
        fa = _sign(attestorKey, fd);
        vm.expectRevert(Error.Redeem__MasterFractionDecreased.selector);
        hubGate.redeem(f, fu, fa, 0);

        f.sharesOut = 30e6 * SP;
        fd = _redeemDigest(f);
        hubGate.redeem(f, _sign(master.key, fd), _sign(attestorKey, fd), 0);
        master.nonce = 3;

        assertEq(usdc.balanceOf(address(master.acct)), 294e5, "master slice capped at his fraction of the co-retire");
        assertEq(redeem.getClaimable(redeemStore, fund, address(p.acct)), 196e5, "puppet slice intact");
        assertEq(share.balanceOf(address(master.acct)), 30e6 * SP, "master keeps a proportional holding");
        assertEq(share.totalSupply(), 50e6 * SP, "both sides retired together");
    }

    function test_liquidate_closes_fund_and_pays_all_holders() public {
        (Puppet memory master, Puppet memory p, address fund, ShareToken share) =
            _setupFund("M5", "P5", 60e6, 50e6, 40e6);

        Redeem.SellIntent memory sp = _sellIntent(p, address(master.acct), 20e6 * SP);
        bytes32 spd = _sellDigest(sp);
        hubGate.sell(sp, _sign(p.key, spd), _sign(attestorKey, spd), 0);
        p.nonce = 3;

        Redeem.LiquidateIntent memory l = Redeem.LiquidateIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            share: _share(address(master.acct)),
            acceptableNetAssetValue: 98e6
        });
        bytes32 ld = _liquidateDigest(l);
        hubGate.liquidate(l, _sign(master.key, ld), _sign(attestorKey, ld), 0);
        master.nonce = 3;

        assertEq(usdc.balanceOf(address(master.acct)), 588e5, "master slice signed onto the account");
        assertEq(master.acct.signedBalanceOf(USDC_ID), 588e5, "exit money ready for the withdraw surface");
        assertEq(usdc.balanceOf(fund), 0, "fund base fully drained");
        assertEq(share.totalSupply(), 20e6 * SP, "unqueued shares remain as closing claims");
        assertEq(redeemStore.closeRateMap(fund), 98e16, "closing per-share rate recorded");
        assertEq(redeemStore.getPool(fund).epoch, 1, "queue rotated at close");
        assertEq(redeemStore.getPool(fund).totalStake, 0, "no live stake survives the close");
        assertEq(usdc.balanceOf(address(redeemStore)), 392e5, "store escrows every remaining claim");

        Allocate.AllocateIntent memory ra = Allocate.AllocateIntent({
            params: _params(master.user),
            share: _share(address(master.acct)),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            acceptableNetAssetValue: 10e6,
            totalShareSupply: 20e6 * SP,
            masterAmount: 10e6,
            puppetList: new address[](0),
            matchedAmountList: new uint[](0)
        });
        bytes32 rad = _allocateDigest(ra);
        bytes memory rau = _sign(master.key, rad);
        bytes memory raa = _sign(attestorKey, rad);
        vm.expectRevert(Error.Share__FundClosed.selector);
        hubGate.allocate(ra, new bytes[](0), new bytes[](0), rau, raa, 0);

        Redeem.SellIntent memory sBlocked = _sellIntent(p, address(master.acct), 1 * SP);
        bytes32 sbd = _sellDigest(sBlocked);
        bytes memory sbu = _sign(p.key, sbd);
        bytes memory sba = _sign(attestorKey, sbd);
        vm.expectRevert(Error.Share__FundClosed.selector);
        hubGate.sell(sBlocked, sbu, sba, 0);

        Redeem.RedeemIntent memory rb = Redeem.RedeemIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            share: _share(address(master.acct)),
            sharesOut: 0,
            assetsOut: 1,
            acceptableNetAssetValue: 1
        });
        bytes32 rbd = _redeemDigest(rb);
        bytes memory rbu = _sign(master.key, rbd);
        bytes memory rba = _sign(attestorKey, rbd);
        vm.expectRevert(Error.Share__FundClosed.selector);
        hubGate.redeem(rb, rbu, rba, 0);

        l.nonce = master.nonce;
        bytes32 l2d = _liquidateDigest(l);
        bytes memory l2u = _sign(master.key, l2d);
        bytes memory l2a = _sign(attestorKey, l2d);
        vm.expectRevert(Error.Share__FundClosed.selector);
        hubGate.liquidate(l, l2u, l2a, 0);

        assertEq(redeem.getClaimable(redeemStore, fund, address(p.acct)), 196e5, "queue side of the closing claim");
        uint pBalBefore = usdc.balanceOf(address(p.acct));
        Redeem.ClaimIntent memory cp = Redeem.ClaimIntent({
            params: _params(p.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: p.nonce,
            chainId: block.chainid,
            share: _share(address(master.acct)),
            amount: 392e5
        });
        bytes32 cpd = _claimDigest(cp);
        hubGate.claim(cp, _sign(p.key, cpd), _sign(attestorKey, cpd), 0);

        assertEq(
            usdc.balanceOf(address(p.acct)) - pBalBefore, 392e5, "queue accrual plus surrendered shares in one claim"
        );
        assertEq(share.totalSupply(), 0, "all shares surrendered");
        assertEq(usdc.balanceOf(address(redeemStore)), 0, "store fully attributed");
    }

    function test_near_fulfill_residue_parks_pool_until_healed() public {
        (Puppet memory master, Puppet memory p, address fund, ShareToken share) =
            _setupFund("M6", "P6", 60e6, 50e6, 40e6);

        Redeem.SellIntent memory sp = _sellIntent(p, address(master.acct), 20e6 * SP);
        bytes32 spd = _sellDigest(sp);
        hubGate.sell(sp, _sign(p.key, spd), _sign(attestorKey, spd), 0);
        p.nonce = 3;

        Redeem.RedeemIntent memory f = Redeem.RedeemIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            share: _share(address(master.acct)),
            sharesOut: 0,
            assetsOut: 196e5 - 1,
            acceptableNetAssetValue: 98e6
        });
        bytes32 fd = _redeemDigest(f);
        hubGate.redeem(f, _sign(master.key, fd), _sign(attestorKey, fd), 0);
        master.nonce = 3;
        assertGt(share.balanceOf(address(redeemStore)), 0, "near-fulfill left a share residue");
        assertEq(redeemStore.getPool(fund).epoch, 0, "no rotation on the residue");

        Redeem.SellIntent memory sp2 = _sellIntent(p, address(master.acct), 1e6 * SP);
        bytes32 sp2d = _sellDigest(sp2);
        bytes memory sp2u = _sign(p.key, sp2d);
        bytes memory sp2a = _sign(attestorKey, sp2d);
        vm.expectRevert(Error.Share__PoolDegraded.selector);
        hubGate.sell(sp2, sp2u, sp2a, 0);

        uint navAfter = usdc.balanceOf(fund);
        f.nonce = master.nonce;
        f.acceptableNetAssetValue = navAfter;
        f.assetsOut = share.balanceOf(address(redeemStore)) * navAfter / share.totalSupply();
        fd = _redeemDigest(f);
        hubGate.redeem(f, _sign(master.key, fd), _sign(attestorKey, fd), 0);
        assertEq(redeemStore.getPool(fund).epoch, 1, "fulfilling the residue rotated and healed the pool");

        hubGate.sell(sp2, sp2u, sp2a, 0);
        assertEq(redeemStore.getPosition(fund, address(p.acct)).stake, 1e6 * SP, "fresh epoch accepts sells at par");
    }
}
