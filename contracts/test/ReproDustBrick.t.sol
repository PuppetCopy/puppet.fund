// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {stdError} from "forge-std/src/Test.sol";

import {V2Base} from "./Base.t.sol";
import {AllocateModule, ALLOCATE_INTENT_TYPEHASH} from "src/hub/AllocateModule.sol";
import {SubscribeModule, SUBSCRIBE_INTENT_TYPEHASH} from "src/hub/SubscribeModule.sol";
import {
    RedeemModule,
    SELL_INTENT_TYPEHASH,
    FULFILL_INTENT_TYPEHASH,
    CLAIM_INTENT_TYPEHASH
} from "src/hub/RedeemModule.sol";
import {RuleLib, MANDATE_TYPEHASH} from "src/utils/RuleLib.sol";
import {ShareToken} from "src/hub/ShareToken.sol";
import {Error} from "src/utils/Error.sol";

contract ReproDustBrickTest is V2Base {
    function _allocateDigest(
        AllocateModule.AllocateIntent memory _i
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

    function _sellDigest(
        RedeemModule.SellIntent memory _s
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

    function _sellIntent(
        Puppet memory _holder,
        address _master,
        uint _sharesOut
    ) internal view returns (RedeemModule.SellIntent memory) {
        return RedeemModule.SellIntent({
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

    function test_dust_stake_bricks_reopen_forever() public {
        Puppet memory master = _makePuppet("M");
        Puppet memory p = _makePuppet("P");
        _seedSignedUsdc(address(p.acct), 10e6);
        address fund = accountModule.predictFundAccount(address(master.acct));
        usdc.mint(accountModule.predictRoute(address(master.acct)), 100e6);

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
        SubscribeModule.SubscribeIntent memory sub = SubscribeModule.SubscribeIntent({
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
        matchedList[0] = 1;
        bytes[] memory bodyList = new bytes[](1);
        bodyList[0] = body;
        bytes[] memory mandateList = new bytes[](1);
        mandateList[0] = mandateSig;

        AllocateModule.AllocateIntent memory a = AllocateModule.AllocateIntent({
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
            puppetList: puppetList,
            matchedAmountList: matchedList
        });
        bytes32 ad = _allocateDigest(a);
        hubGate.allocate(a, bodyList, mandateList, _sign(master.key, ad), _sign(attestorKey, ad), 2e6);
        master.nonce = 2;

        ShareToken share = hubGate.predictShareToken(_share(address(master.acct)));
        assertEq(share.balanceOf(address(p.acct)), 1 * SP, "puppet got 1e12 shares for 1 wei");
        assertEq(share.balanceOf(address(master.acct)), 100e6 * SP, "master shares");
        assertEq(usdc.balanceOf(fund), 98e6 + 1, "fund base after fee");

        RedeemModule.SellIntent memory sp = _sellIntent(p, address(master.acct), 1 * SP);
        bytes32 spd = _sellDigest(sp);
        hubGate.sell(sp, _sign(p.key, spd), _sign(attestorKey, spd), 0);
        p.nonce = 3;

        RedeemModule.SellIntent memory sm = _sellIntent(master, address(master.acct), 100e6 * SP);
        bytes32 smd = _sellDigest(sm);
        hubGate.sell(sm, _sign(master.key, smd), _sign(attestorKey, smd), 0);
        master.nonce = 3;

        uint supply = share.totalSupply();
        assertEq(share.balanceOf(address(redeemStore)), supply, "store holds entire supply");

        RedeemModule.FulfillIntent memory f = RedeemModule.FulfillIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            share: _share(address(master.acct)),
            sharesOut: 0,
            acceptableNetAssetValue: 98e6 + 1,
            totalShareSupply: supply,
            acceptableShares: type(uint).max
        });
        bytes32 fd = _digest(
            hubGateDomain,
            keccak256(
                abi.encode(
                    FULFILL_INTENT_TYPEHASH,
                    _hashAccount(f.params.user, address(0)),
                    f.blockNumber,
                    f.deadline,
                    f.acceptableRelayFee,
                    f.nonce,
                    f.chainId,
                    _hashShare(f.share),
                    f.sharesOut,
                    f.acceptableNetAssetValue,
                    f.totalShareSupply,
                    f.acceptableShares
                )
            )
        );
        hubGate.fulfill(f, _sign(master.key, fd), _sign(attestorKey, fd), 0);
        master.nonce = 4;
        assertEq(share.totalSupply(), 0, "full retire");

        RedeemModule.SellIntent memory sBlocked = _sellIntent(master, address(master.acct), 1);
        bytes32 sbd = _sellDigest(sBlocked);
        bytes memory sbu = _sign(master.key, sbd);
        bytes memory sba = _sign(attestorKey, sbd);
        vm.expectRevert(stdError.divisionError);
        hubGate.sell(sBlocked, sbu, sba, 0);

        uint claimableP = redeem.getClaimable(redeemStore, fund, address(p.acct));
        uint claimableM = redeem.getClaimable(redeemStore, fund, address(master.acct));
        emit log_named_uint("puppet claimable", claimableP);
        emit log_named_uint("master claimable", claimableM);
        emit log_named_uint("puppet stake", redeemStore.getPosition(fund, address(p.acct)).stake);
        assertEq(claimableP, 0, "dust staker entitlement floors to zero");

        RedeemModule.ClaimIntent memory cm = RedeemModule.ClaimIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            share: _share(address(master.acct)),
            amount: claimableM
        });
        bytes32 cmd = _digest(
            hubGateDomain,
            keccak256(
                abi.encode(
                    CLAIM_INTENT_TYPEHASH,
                    _hashAccount(master.user, address(0)),
                    cm.blockNumber,
                    cm.deadline,
                    cm.acceptableRelayFee,
                    cm.nonce,
                    cm.chainId,
                    _hashShare(cm.share),
                    cm.amount
                )
            )
        );
        hubGate.claim(cm, _sign(master.key, cmd), _sign(attestorKey, cmd), 0);
        master.nonce = 5;

        assertEq(redeemStore.getPool(fund).totalStake, 1 * SP, "dust stake stranded");

        RedeemModule.ClaimIntent memory cp = RedeemModule.ClaimIntent({
            params: _params(p.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: p.nonce,
            chainId: block.chainid,
            share: _share(address(master.acct)),
            amount: 1
        });
        bytes32 cpd = _digest(
            hubGateDomain,
            keccak256(
                abi.encode(
                    CLAIM_INTENT_TYPEHASH,
                    _hashAccount(p.user, address(0)),
                    cp.blockNumber,
                    cp.deadline,
                    cp.acceptableRelayFee,
                    cp.nonce,
                    cp.chainId,
                    _hashShare(cp.share),
                    cp.amount
                )
            )
        );
        bytes memory cpu = _sign(p.key, cpd);
        bytes memory cpa = _sign(attestorKey, cpd);
        vm.expectRevert(Error.Share__InsufficientClaimable.selector);
        hubGate.claim(cp, cpu, cpa, 0);

        usdc.mint(accountModule.predictRoute(address(master.acct)), 50e6);
        AllocateModule.AllocateIntent memory ra = AllocateModule.AllocateIntent({
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
        bytes memory rau = _sign(master.key, rad);
        bytes memory raa = _sign(attestorKey, rad);
        vm.expectRevert(Error.Share__Empty.selector);
        hubGate.allocate(ra, new bytes[](0), new bytes[](0), rau, raa, 0);

        emit log_named_uint("stranded store base", usdc.balanceOf(address(redeemStore)));
    }

    function test_clean_two_holder_unwind_reopens() public {
        Puppet memory master = _makePuppet("M2");
        Puppet memory p = _makePuppet("P2");
        _seedSignedUsdc(address(p.acct), 50e6);
        address fund = accountModule.predictFundAccount(address(master.acct));
        usdc.mint(accountModule.predictRoute(address(master.acct)), 60e6);

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
        SubscribeModule.SubscribeIntent memory sub = SubscribeModule.SubscribeIntent({
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
        matchedList[0] = 40e6;
        bytes[] memory bodyList = new bytes[](1);
        bodyList[0] = body;
        bytes[] memory mandateList = new bytes[](1);
        mandateList[0] = mandateSig;

        AllocateModule.AllocateIntent memory a = AllocateModule.AllocateIntent({
            params: _params(master.user),
            share: _share(address(master.acct)),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 2e6,
            nonce: master.nonce,
            chainId: block.chainid,
            acceptableNetAssetValue: 100e6,
            totalShareSupply: 0,
            masterAmount: 60e6,
            puppetList: puppetList,
            matchedAmountList: matchedList
        });
        bytes32 ad = _allocateDigest(a);
        hubGate.allocate(a, bodyList, mandateList, _sign(master.key, ad), _sign(attestorKey, ad), 2e6);
        master.nonce = 2;

        ShareToken share = hubGate.predictShareToken(_share(address(master.acct)));
        assertEq(usdc.balanceOf(fund), 98e6, "fund base after fee");

        RedeemModule.SellIntent memory sp = _sellIntent(p, address(master.acct), 40e6 * SP);
        bytes32 spd = _sellDigest(sp);
        hubGate.sell(sp, _sign(p.key, spd), _sign(attestorKey, spd), 0);
        p.nonce = 3;

        RedeemModule.SellIntent memory sm = _sellIntent(master, address(master.acct), 60e6 * SP);
        bytes32 smd = _sellDigest(sm);
        hubGate.sell(sm, _sign(master.key, smd), _sign(attestorKey, smd), 0);
        master.nonce = 3;

        uint supply = share.totalSupply();
        RedeemModule.FulfillIntent memory f = RedeemModule.FulfillIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            share: _share(address(master.acct)),
            sharesOut: 0,
            acceptableNetAssetValue: 98e6,
            totalShareSupply: supply,
            acceptableShares: type(uint).max
        });
        bytes32 fd = _digest(
            hubGateDomain,
            keccak256(
                abi.encode(
                    FULFILL_INTENT_TYPEHASH,
                    _hashAccount(f.params.user, address(0)),
                    f.blockNumber,
                    f.deadline,
                    f.acceptableRelayFee,
                    f.nonce,
                    f.chainId,
                    _hashShare(f.share),
                    f.sharesOut,
                    f.acceptableNetAssetValue,
                    f.totalShareSupply,
                    f.acceptableShares
                )
            )
        );
        hubGate.fulfill(f, _sign(master.key, fd), _sign(attestorKey, fd), 0);
        master.nonce = 4;

        uint claimableP = redeem.getClaimable(redeemStore, fund, address(p.acct));
        uint claimableM = redeem.getClaimable(redeemStore, fund, address(master.acct));
        emit log_named_uint("puppet claimable", claimableP);
        emit log_named_uint("master claimable", claimableM);

        RedeemModule.ClaimIntent memory cp = RedeemModule.ClaimIntent({
            params: _params(p.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: p.nonce,
            chainId: block.chainid,
            share: _share(address(master.acct)),
            amount: claimableP
        });
        bytes32 cpd = _digest(
            hubGateDomain,
            keccak256(
                abi.encode(
                    CLAIM_INTENT_TYPEHASH,
                    _hashAccount(p.user, address(0)),
                    cp.blockNumber,
                    cp.deadline,
                    cp.acceptableRelayFee,
                    cp.nonce,
                    cp.chainId,
                    _hashShare(cp.share),
                    cp.amount
                )
            )
        );
        hubGate.claim(cp, _sign(p.key, cpd), _sign(attestorKey, cpd), 0);
        p.nonce = 4;

        RedeemModule.ClaimIntent memory cm = RedeemModule.ClaimIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            share: _share(address(master.acct)),
            amount: claimableM
        });
        bytes32 cmd = _digest(
            hubGateDomain,
            keccak256(
                abi.encode(
                    CLAIM_INTENT_TYPEHASH,
                    _hashAccount(master.user, address(0)),
                    cm.blockNumber,
                    cm.deadline,
                    cm.acceptableRelayFee,
                    cm.nonce,
                    cm.chainId,
                    _hashShare(cm.share),
                    cm.amount
                )
            )
        );
        hubGate.claim(cm, _sign(master.key, cmd), _sign(attestorKey, cmd), 0);
        master.nonce = 5;

        assertEq(redeemStore.getPool(fund).totalStake, 0, "clean unwind drains stake");
        emit log_named_uint("stranded store base", usdc.balanceOf(address(redeemStore)));

        usdc.mint(accountModule.predictRoute(address(master.acct)), 50e6);
        AllocateModule.AllocateIntent memory ra = AllocateModule.AllocateIntent({
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
}
