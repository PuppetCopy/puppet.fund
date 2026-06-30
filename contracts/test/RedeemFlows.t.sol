// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {V2Base} from "./Base.t.sol";
import {Allocate, ALLOCATE_INTENT_TYPEHASH} from "src/hub/Allocate.sol";
import {Mandate, MANDATE_INTENT_TYPEHASH} from "src/hub/Mandate.sol";
import {Redeem, REDEEM_INTENT_TYPEHASH} from "src/hub/Redeem.sol";
import {RuleLib} from "src/utils/RuleLib.sol";
import {ShareToken} from "src/hub/ShareToken.sol";
import {PuppetAccount} from "src/core/PuppetAccount.sol";

contract RedeemFlowsTest is V2Base {
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
                    _hashFundParams(_i.fundParams),
                    _i.acceptableNetAssetValue,
                    _i.totalShareSupply,
                    _i.masterAmount,
                    keccak256(abi.encodePacked(_i.puppetList)),
                    keccak256(abi.encodePacked(_i.allocatedAmountList))
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
        fund = _fundOf(address(master.acct));
        Allocate.AllocateIntent memory a = Allocate.AllocateIntent({
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
        bytes32 ad = _allocateDigest(a);
        hubGate.allocate(a, new bytes[](0), new bytes[](0), _sign(master.key, ad), _sign(attestorKey, ad), 2e6);
        master.nonce = 2;
    }

    function test_mandate_runs_to_completion() public {
        (, address fund) = _seedFund("M");
        Puppet memory p = _makePuppet("P");
        _seedSignedUsdc(address(p.acct), 100e6);

        RuleLib.Rule[] memory rules = new RuleLib.Rule[](1);
        rules[0] = RuleLib.Rule({fund: fund, body: "", mandate: ""});
        bytes32 ruleHash = keccak256(
            abi.encode(
                keccak256("FundMandateRule(address fund,bytes body,bytes mandate)"),
                rules[0].fund,
                keccak256(rules[0].body),
                keccak256(rules[0].mandate)
            )
        );
        bytes32 rulesHash = keccak256(abi.encodePacked(ruleHash));

        Mandate.MandateIntent memory intent = Mandate.MandateIntent({
            params: _params(p.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 5e6,
            nonce: p.nonce,
            chainId: block.chainid,
            baseToken: address(usdc),
            rules: rules
        });
        bytes32 d = _digest(
            hubGateDomain,
            keccak256(
                abi.encode(
                    MANDATE_INTENT_TYPEHASH,
                    _hashAccount(p.user, address(0)),
                    intent.blockNumber,
                    intent.deadline,
                    intent.acceptableRelayFee,
                    intent.nonce,
                    intent.chainId,
                    intent.baseToken,
                    rulesHash
                )
            )
        );
        uint feeBefore = usdc.balanceOf(feeReceiver);
        hubGate.mandate(intent, _sign(p.key, d), _sign(attestorKey, d), 5e6);

        assertEq(usdc.balanceOf(feeReceiver) - feeBefore, 5e6, "mandate fee from puppet signed base");
        assertEq(p.acct.signedBalanceOf(address(usdc)), 95e6, "puppet signed debited");
    }

    function test_mandate_onboards_fresh_puppet_from_route() public {
        (, address fund) = _seedFund("M");
        (address user, uint key) = makeAddrAndKey("OP");
        address puppet = accountModule.predictPuppetAccount(_params(user));
        address route = accountModule.predictRoute(puppet);
        uint deposit = 100e6;
        uint fee = 2e6;
        usdc.mint(route, deposit);

        RuleLib.Rule[] memory rules = new RuleLib.Rule[](1);
        rules[0] = RuleLib.Rule({fund: fund, body: "", mandate: ""});
        bytes32 ruleHash = keccak256(
            abi.encode(
                keccak256("FundMandateRule(address fund,bytes body,bytes mandate)"),
                rules[0].fund,
                keccak256(rules[0].body),
                keccak256(rules[0].mandate)
            )
        );
        Mandate.MandateIntent memory intent = Mandate.MandateIntent({
            params: _params(user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: fee,
            nonce: 0,
            chainId: block.chainid,
            baseToken: address(usdc),
            rules: rules
        });
        bytes32 d = _digest(
            hubGateDomain,
            keccak256(
                abi.encode(
                    MANDATE_INTENT_TYPEHASH,
                    _hashAccount(user, address(0)),
                    intent.blockNumber,
                    intent.deadline,
                    intent.acceptableRelayFee,
                    intent.nonce,
                    intent.chainId,
                    intent.baseToken,
                    keccak256(abi.encodePacked(ruleHash))
                )
            )
        );

        assertEq(puppet.code.length, 0, "puppet not yet deployed");
        uint feeBefore = usdc.balanceOf(feeReceiver);
        hubGate.mandate(intent, _signDeploy(key), "", _sign(key, d), _sign(attestorKey, d), fee);

        assertGt(puppet.code.length, 0, "puppet deployed by mandate");
        assertEq(usdc.balanceOf(route), 0, "deposit route swept");
        assertEq(usdc.balanceOf(feeReceiver) - feeBefore, fee, "fee paid from recognized route funds");
        assertEq(
            PuppetAccount(payable(puppet)).signedBalanceOf(address(usdc)), deposit - fee, "route recognized into signed net of fee"
        );
    }

    function _buildAllocate(
        Puppet memory master,
        uint nonce,
        uint amount
    ) internal view returns (Allocate.AllocateIntent memory a, bytes32 ad) {
        a = Allocate.AllocateIntent({
            params: _params(master.user),
            fundParams: _fundParams(address(master.acct)),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: nonce,
            chainId: block.chainid,
            acceptableNetAssetValue: amount,
            totalShareSupply: 0,
            masterAmount: amount,
            puppetList: new address[](0),
            allocatedAmountList: new uint[](0)
        });
        ad = _allocateDigest(a);
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
                    _hashFundParams(f.fundParams),
                    f.sharesOut,
                    f.assetsOut,
                    f.acceptableNetAssetValue
                )
            )
        );
    }

    function test_redeem_self_sell_pays_wallet_and_reopens() public {
        (Puppet memory master, address fund) = _seedFund("M");

        Redeem.RedeemIntent memory f = Redeem.RedeemIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            fundParams: _fundParams(address(master.acct)),
            sharesOut: 100e6 * SP,
            assetsOut: 98e6,
            acceptableNetAssetValue: 98e6
        });
        bytes32 fd = _redeemDigest(f);
        hubGate.redeem(f, _sign(master.key, fd), _sign(attestorKey, fd), 0);
        master.nonce = 3;

        ShareToken share = hubGate.predictShareToken(_fundParams(address(master.acct)));
        assertEq(share.totalSupply(), 0, "self-sell queued and entire supply retired in one intent");
        assertEq(usdc.balanceOf(fund), 0, "fund base fully drained at NAV");
        assertEq(usdc.balanceOf(address(master.acct)), 98e6, "full NAV lands on the puppet account in one intent");
        assertEq(master.acct.signedBalanceOf(address(usdc)), 98e6, "proceeds signed for the withdraw surface");
        assertEq(redeem.getClaimable(redeemStore, fund, address(master.acct)), 0, "no claim left behind");
        assertEq(redeemStore.getPosition(fund, address(master.acct)).weight, 0, "position purged");
        assertEq(redeemStore.getPool(fund).weight, 0, "stake purged, fund reopenable");

        usdc.mint(accountModule.predictRoute(address(master.acct)), 50e6);
        (Allocate.AllocateIntent memory ra, bytes32 rad) = _buildAllocate(master, master.nonce, 50e6);
        hubGate.allocate(ra, new bytes[](0), new bytes[](0), _sign(master.key, rad), _sign(attestorKey, rad), 0);
        assertEq(share.totalSupply(), 50e6 * SP, "reopened without any claim leg");
    }

    function test_redeem_partial_retire_carries_stake_then_exits() public {
        (Puppet memory master, address fund) = _seedFund("M");
        ShareToken share = hubGate.predictShareToken(_fundParams(address(master.acct)));

        Redeem.RedeemIntent memory r1 = Redeem.RedeemIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            fundParams: _fundParams(address(master.acct)),
            sharesOut: 100e6 * SP,
            assetsOut: 49e6,
            acceptableNetAssetValue: 98e6
        });
        bytes32 r1d = _redeemDigest(r1);
        hubGate.redeem(r1, _sign(master.key, r1d), _sign(attestorKey, r1d), 0);
        master.nonce = 3;

        assertEq(share.totalSupply(), 50e6 * SP, "only the paid-for half retired");
        assertEq(usdc.balanceOf(fund), 49e6, "half the NAV drained");
        assertEq(usdc.balanceOf(address(master.acct)), 49e6, "first slice auto-flushed to the account");
        assertEq(redeem.getClaimable(redeemStore, fund, address(master.acct)), 0, "nothing banked");
        assertEq(redeemStore.getPosition(fund, address(master.acct)).weight, 100e6 * SP, "live stake carried");

        Redeem.RedeemIntent memory r2 = Redeem.RedeemIntent({
            params: _params(master.user),
            blockNumber: block.number,
            deadline: block.timestamp + 60,
            acceptableRelayFee: 0,
            nonce: master.nonce,
            chainId: block.chainid,
            fundParams: _fundParams(address(master.acct)),
            sharesOut: 0,
            assetsOut: 49e6,
            acceptableNetAssetValue: 49e6
        });
        bytes32 r2d = _redeemDigest(r2);
        hubGate.redeem(r2, _sign(master.key, r2d), _sign(attestorKey, r2d), 0);

        assertEq(usdc.balanceOf(address(master.acct)), 98e6, "both slices, no double count");
        assertEq(usdc.balanceOf(fund), 0, "fully drained");
        assertEq(share.totalSupply(), 0, "rest retired");
        assertEq(redeem.getClaimable(redeemStore, fund, address(master.acct)), 0, "nothing left behind");
        assertEq(redeemStore.getPool(fund).weight, 0, "pool clean");
    }
}
