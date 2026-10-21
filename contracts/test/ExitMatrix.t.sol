// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Vm} from "forge-std/src/Vm.sol";

import {MAX_SKIN} from "src/HubGate.sol";
import {AccountModule} from "src/core/AccountModule.sol";
import {EscrowStore} from "src/core/EscrowStore.sol";
import {Fund, PRICE_PRECISION, VIRTUAL_SHARES, VIRTUAL_VALUE} from "src/core/Fund.sol";
import {Redeem} from "src/core/Redeem.sol";
import {FundAccount} from "src/core/FundAccount.sol";
import {FundStore, isOpen} from "src/core/FundStore.sol";
import {GRID_BYTES, ShareToken} from "src/core/ShareToken.sol";
import {UserAccount} from "src/core/UserAccount.sol";
import {Error} from "src/utils/Error.sol";
import {AccountLib, ESCROW_RETURN_DELAY} from "src/utils/AccountLib.sol";
import {MandateLib} from "src/utils/MandateLib.sol";
import {BalanceLib} from "src/utils/BalanceLib.sol";
import {SwapLib} from "src/utils/SwapLib.sol";
import {Deposit} from "src/core/Deposit.sol";
import {IAccount} from "src/utils/interfaces/IAccount.sol";
import {LiquidityGate, WITHDRAW_INTENT_TYPEHASH} from "src/utils/LiquidityGate.sol";

import {HotPathTest} from "./HotPath.t.sol";

contract ExitMatrixTest is HotPathTest {
    function _open() internal {
        _escrowOnHub(address(usdc), 500e6);
        bytes32 _symbol = bytes32("EXM");
        bytes memory _pixels = new bytes(GRID_BYTES);
        shareToken = ShareToken(
            address(
                uint160(
                    uint(
                        keccak256(
                            abi.encodePacked(
                                bytes1(0xff),
                                address(hub),
                                bytes32(uint(uint160(body))),
                                keccak256(
                                    _cloneCode(
                                        fundModule.shareImpl(), abi.encodePacked(body, _symbol, _pixels, uint16(PERFORMANCE_FEE))
                                    )
                                )
                            )
                        )
                    )
                )
            )
        );
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(0, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), body, _account(master));
        hub.createFund(_symbol, _pixels, _coSig(bodyKey, _genesis), _fundApproval(masterKey, body), _i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(body), 499e18, "the opening round mints the master one share unit per wei of value");
        assertEq(usdc.balanceOf(body), 499e6, "and lands the hub escrow net of the round fee");
        _wethTo(body, 10_000e18);
    }

    function _openSecondFund() internal {
        (master, masterKey) = makeAddrAndKey("master-2");
        (body, bodyKey) = makeAddrAndKey("body-2");
        vm.signAndAttachDelegation(accountModule.bodyImpl(), bodyKey);
        _open();
    }

    function _back(
        string memory _tag,
        uint _amount,
        uint _sharePrice
    ) internal returns (address user_, uint key_) {
        (user_, key_) = makeAddrAndKey(_tag);
        _fundWallet(user_, _amount * 2 + 10e6);
        MandateLib.Mandate memory _m = MandateLib.Mandate({
            master: body, skin: MAX_SKIN, allocationRate: 5000, exitCap: 10_000, cooldownPeriod: 0, expiry: block.timestamp + 365 days
        });
        MandateLib.Mandate[] memory _one = new MandateLib.Mandate[](1);
        _one[0] = _m;
        _mandate(user_, key_, _one);
        address _acct = _account(user_);
        Fund.Allocation[] memory _rows = new Fund.Allocation[](1);
        _rows[0] = _row(_acct, _amount);
        uint _supply = shareToken.totalSupply() + VIRTUAL_SHARES;
        uint _nav = Math.mulDiv(_sharePrice, _supply, PRICE_PRECISION);
        uint _stake = shareToken.balanceOf(_acct);
        uint _cost = fundStore.getHolding(body, _acct).cost;
        (Fund.AllocateIntent memory _i,) = _allocateIntent(_nonceOf(body), 0, _rows);
        _i.valuation.assetList[0].value = _nav - VIRTUAL_VALUE;
        hub.allocate(_i, _pair(masterKey, _allocateDigest(_i)), _ownerCoSig(_i));
        uint _paid = (_amount - FEE) * USD;
        uint _minted = Math.mulDiv(_paid, _supply, _nav);
        assertEq(shareToken.balanceOf(_acct), _stake + _minted, "a backer is minted at the share price net of the round fee");
        assertEq(
            fundStore.getHolding(body, _acct).cost,
            (_cost * _stake + _paid * PRICE_PRECISION) / (_stake + _minted),
            "and its holding keeps the price it paid per share"
        );
    }

    function _intentAt(
        uint _fraction,
        uint _join,
        uint _sharePrice
    ) internal view returns (Redeem.RedeemIntent memory) {
        Fund.Valuation memory _v = _valuation(0);
        _v.assetList[0].value =
            Math.mulDiv(_sharePrice, shareToken.totalSupply() + VIRTUAL_SHARES, PRICE_PRECISION) - VIRTUAL_VALUE;
        return _redeemIntent(_fraction, _join, _v);
    }

    function _redeemAt(
        uint _fraction,
        uint _join,
        uint _sharePrice,
        address[] memory _holderList
    ) internal {
        Redeem.RedeemIntent memory _i = _intentAt(_fraction, _join, _sharePrice);
        hub.redeem(_i, _redeemSig(_i), _holderList);
    }

    function _list3(
        address _a,
        address _b,
        address _c
    ) internal pure returns (address[] memory list_) {
        list_ = new address[](3);
        list_[0] = _a;
        list_[1] = _b;
        list_[2] = _c;
    }

    function _sellUsdcAway() internal {
        vm.startPrank(body);
        usdc.transfer(makeAddr("swapped-usdc"), usdc.balanceOf(body));
        vm.stopPrank();
    }

    function _assertBooked() internal view {
        FundStore.Redemption memory _r = fundStore.getRedemption(body);
        assertEq(
            fundStore.bookedMap(body, _r.token),
            uint(_r.potLeft) + _r.masterPay,
            "the fund's booking is exactly its pot left and the master's pay"
        );
    }

    function _assertClosed() internal view {
        FundStore.Redemption memory _r = fundStore.getRedemption(body);
        assertFalse(isOpen(_r), "the redemption is closed");
        assertEq(_r.potLeft, 0, "with nothing left in its pot");
        assertEq(fundStore.bookedMap(body, _r.token), 0, "nor in its booking");
        assertEq(fundStore.heldMap(_r.token), 0, "the store owes nothing more in that token");
        assertEq(IERC20(_r.token).balanceOf(address(fundStore)), 0, "and nothing ring-fenced for it");
    }

    function test_a_queue_redemption_pays_every_seller_at_one_price_in_one_transaction() public {
        _open();
        (address _a, uint _aKey) = _back("q-a", 401e6, 1e12);
        (address _b, uint _bKey) = _back("q-b", 201e6, 1e12);
        address _aAcct = _account(_a);
        address _bAcct = _account(_b);
        _sell(_a, _aKey, 100e18);
        _sell(_b, _bKey, 50e18);
        assertEq(fundStore.getRedemption(body).queued, 150e18, "the fund queue is the sum of what was sold");
        assertEq(shareToken.balanceOf(_aAcct), 400e18, "sold shares never leave the seller");

        uint _fees = wnt.balanceOf(feeReceiver);
        _redeemAt(0, 0, 1.2e12, _list(_aAcct, _bAcct));
        assertEq(wnt.balanceOf(_aAcct), 117e18, "A is paid its 100 shares at 1.2, less a tenth of its 20 gain and one fee");
        assertEq(wnt.balanceOf(_bAcct), 58e18, "B its 50 at the same price, less a tenth of its 10 gain and one fee");
        assertEq(wnt.balanceOf(_ownerAccount()), 1.7e18, "the owner's account takes the master's 2.7 of those fees, less one fee");
        assertEq(wnt.balanceOf(feeReceiver) - _fees, 3e18, "the fee receiver takes the three fee slices");
        assertEq(wnt.balanceOf(protocolReceiver), 0.3e18, "and the protocol receiver the 0.3 cut");
        assertEq(shareToken.balanceOf(_aAcct), 300e18, "the queued shares burn");
        assertEq(shareToken.balanceOf(_bAcct), 150e18);
        assertEq(_queuedOf(_aAcct) + _queuedOf(_bAcct), 0);
        assertEq(fundStore.getRedemption(body).queued, 0);
        _assertClosed();
    }

    function test_the_open_runs_the_first_cohort_and_a_permissionless_cohort_finishes() public {
        _open();
        (address _a, uint _aKey) = _back("c-a", 101e6, 1e12);
        (address _b, uint _bKey) = _back("c-b", 101e6, 1e12);
        (address _c, uint _cKey) = _back("c-c", 101e6, 1e12);
        _sell(_a, _aKey, 100e18);
        _sell(_b, _bKey, 100e18);
        _sell(_c, _cKey, 100e18);

        _redeemAt(0, 0, 1e12, _list(_account(_a)));
        assertEq(wnt.balanceOf(_account(_a)), 99e18, "the open pays its first cohort");
        assertEq(wnt.balanceOf(_account(_b)), 0, "and nobody it did not list");
        FundStore.Redemption memory _r = fundStore.getRedemption(body);
        assertTrue(isOpen(_r), "the rest keeps the redemption open");
        assertEq(_r.owedLeft, 200e18 * 1e4, "with their claims owed");
        assertEq(_r.potLeft, 200e18, "and their payout ring-fenced");
        assertEq(wnt.balanceOf(address(fundStore)), 200e18);
        assertEq(fundStore.bookedMap(body, address(wnt)), 200e18, "and booked to this fund");

        vm.prank(makeAddr("anyone"));
        hub.redeemCohort(shareToken, _list(_account(_b), _account(_c)));
        assertEq(wnt.balanceOf(_account(_b)), 99e18, "anyone can run the next cohort");
        assertEq(wnt.balanceOf(_account(_c)), 99e18);
        _assertClosed();
    }

    function test_a_sell_into_an_open_redemption_settles_the_seller_first_and_queues_the_rest_for_the_next() public {
        _open();
        (address _a, uint _aKey) = _back("s-a", 401e6, 1e12);
        (address _b, uint _bKey) = _back("s-b", 201e6, 1e12);
        address _aAcct = _account(_a);
        _sell(_a, _aKey, 100e18);
        _sell(_b, _bKey, 50e18);
        _redeemAt(0, 0, 1e12, new address[](0));
        uint64 _id = fundStore.getRedemption(body).id;

        _sell(_a, _aKey, 50e18);
        assertEq(wnt.balanceOf(_aAcct), 100e18, "the sell pays A its open claim first, with no cohort fee");
        assertEq(shareToken.balanceOf(_aAcct), 300e18, "burning the queued 100");
        assertEq(_queuedOf(_aAcct), 50e18, "and queues the new 50 for the next redemption");
        assertEq(fundStore.getHolding(body, _aAcct).redeemedAt, _id, "A is marked paid in this one");
        FundStore.Redemption memory _r = fundStore.getRedemption(body);
        assertEq(_r.queued, 100e18, "the fund queue holds B's 50 and A's new 50");
        assertEq(_r.owedLeft, 50e18 * 1e4, "while this redemption still owes only B");

        hub.redeemCohort(shareToken, _list(_aAcct, _account(_b)));
        assertEq(wnt.balanceOf(_aAcct), 100e18, "a marked seller is skipped");
        assertEq(wnt.balanceOf(_account(_b)), 49e18);
        assertFalse(isOpen(fundStore.getRedemption(body)));
        assertEq(fundStore.getRedemption(body).queued, 50e18, "A's new sale waits for the next");

        _redeemAt(0, 0, 1e12, _list(_aAcct));
        assertEq(wnt.balanceOf(_aAcct), 149e18, "and the next redemption pays it");
        _assertClosed();
    }

    function test_a_cohort_skips_paid_and_unowed_holders_and_refuses_the_master() public {
        _open();
        (address _a, uint _aKey) = _back("k-a", 401e6, 1e12);
        (address _b,) = _back("k-b", 201e6, 1e12);
        _sell(_a, _aKey, 100e18);
        _redeemAt(0, 0, 1e12, new address[](0));

        vm.expectRevert(abi.encodeWithSelector(Error.Fund__NotHolder.selector, body));
        hub.redeemCohort(shareToken, _list(body));

        hub.redeemCohort(shareToken, _list3(_account(_b), _account(_a), _account(_a)));
        assertEq(wnt.balanceOf(_account(_a)), 99e18, "a listed seller is paid once");
        assertEq(wnt.balanceOf(_account(_b)), 0, "a holder with nothing queued is not paid in a queue redemption");
        assertEq(fundStore.getHolding(body, _account(_b)).redeemedAt, 0, "nor marked");
        assertEq(shareToken.balanceOf(_account(_b)), 200e18);
        _assertClosed();

        hub.redeemCohort(shareToken, _list(_account(_a)));
        assertEq(wnt.balanceOf(_account(_a)), 99e18, "a cohort on a closed redemption does nothing");
    }

    function test_cohorts_racing_in_one_block_never_revert_nor_pay_twice() public {
        _open();
        (address _a,) = _back("race-a", 401e6, 1e12);
        (address _b,) = _back("race-b", 201e6, 1e12);
        (address _c,) = _back("race-c", 201e6, 1e12);
        address _aAcct = _account(_a);
        address _bAcct = _account(_b);
        address _cAcct = _account(_c);

        Redeem.RedeemIntent memory _i = _intentAt(2000, 0, 1e12);
        bytes memory _sig = _redeemSig(_i);
        address[] memory _masterFirst = _list(_aAcct, _bAcct);
        address[] memory _attackerFirst = _list(_cAcct);
        vm.prank(makeAddr("attacker"));
        hub.redeem(_i, _sig, _attackerFirst);
        assertEq(wnt.balanceOf(_cAcct), 39e18, "a replayed open runs as signed, with the replayer's first cohort");
        vm.expectRevert(abi.encodeWithSelector(Error.Account__NonceMismatch.selector, body, _i.header.nonce + 1, _i.header.nonce));
        hub.redeem(_i, _sig, _masterFirst);

        vm.prank(makeAddr("attacker"));
        hub.redeemCohort(shareToken, _list(_aAcct));
        uint[4] memory _paid = [wnt.balanceOf(_aAcct), wnt.balanceOf(_bAcct), wnt.balanceOf(_cAcct), wnt.balanceOf(feeReceiver)];
        hub.redeemCohort(shareToken, _list3(_aAcct, _bAcct, _cAcct));
        assertEq(wnt.balanceOf(_aAcct), _paid[0], "the master's racing cohort skips whoever the attacker paid");
        assertEq(wnt.balanceOf(_cAcct), _paid[2]);
        assertEq(wnt.balanceOf(_bAcct) - _paid[1], 39e18, "and pays the rest");
        assertEq(wnt.balanceOf(_ownerAccount()), 98.8e18, "the master once, last");
        _assertClosed();

        _paid[3] = wnt.balanceOf(feeReceiver);
        vm.prank(makeAddr("attacker"));
        hub.redeemCohort(shareToken, _list3(_aAcct, _bAcct, _cAcct));
        assertEq(wnt.balanceOf(_ownerAccount()), 98.8e18, "a late racer finds nothing to pay");
        assertEq(wnt.balanceOf(feeReceiver), _paid[3], "and charges nobody");
    }

    function test_the_master_joins_the_queue_up_to_symmetry_and_is_paid_last() public {
        _open();
        (address _a, uint _aKey) = _back("j-a", 401e6, 1e12);
        _sell(_a, _aKey, 160e18);

        address[] memory _first = _list(_account(_a));
        Redeem.RedeemIntent memory _i = _intentAt(0, 199.6e18 + 1, 1.5e12);
        bytes memory _sig = _redeemSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Redeem__JoinAboveSymmetry.selector, 199.6e18 + 1, 199.6e18));
        hub.redeem(_i, _sig, _first);

        uint _fees = wnt.balanceOf(feeReceiver);
        _redeemAt(0, 199.6e18, 1.5e12, _list(_account(_a)));
        assertEq(wnt.balanceOf(_account(_a)), 231e18, "A is paid its 160 at 1.5, less a tenth of its 80 gain and one fee");
        assertEq(
            wnt.balanceOf(_ownerAccount()),
            305.6e18,
            "the master's 199.6 at the same price, no fee on its own gain, with 7.2 of A's fee, less one fee, paid last"
        );
        assertEq(wnt.balanceOf(feeReceiver) - _fees, 2e18, "the fee receiver takes the two fee slices");
        assertEq(wnt.balanceOf(protocolReceiver), 0.8e18, "and the protocol receiver the 0.8 cut");
        assertEq(shareToken.balanceOf(body), 299.4e18, "the master exits the same 40% of its stake as A");
        assertEq(shareToken.balanceOf(_account(_a)), 240e18);
        _assertClosed();
    }

    function test_a_join_without_a_queue_needs_the_master_alone_in_the_fund() public {
        _open();
        _redeemAt(0, 100e18, 1e12, new address[](0));
        assertEq(wnt.balanceOf(_ownerAccount()), 99e18, "a sole master redeems any part in one transaction");
        assertEq(shareToken.balanceOf(body), 399e18);
        _assertClosed();

        (address _a,) = _back("solo-a", 101e6, 1e12);
        address[] memory _first = _list(_account(_a));
        Redeem.RedeemIntent memory _i = _intentAt(0, 1, 1e12);
        bytes memory _sig = _redeemSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Redeem__JoinAboveSymmetry.selector, 1, 0));
        hub.redeem(_i, _sig, _first);
    }

    function test_everyone_burns_the_same_fraction_of_every_stake_and_pays_one_price() public {
        _open();
        (address _a,) = _back("e-a", 401e6, 1e12);
        (address _b,) = _back("e-b", 201e6, 1e12);
        uint _fees = wnt.balanceOf(feeReceiver);
        _redeemAt(2500, 0, 1.1e12, _list(_account(_a), _account(_b)));
        assertEq(shareToken.balanceOf(_account(_a)), 300e18, "A burns a quarter");
        assertEq(shareToken.balanceOf(_account(_b)), 150e18, "B burns a quarter");
        assertEq(shareToken.balanceOf(body), 374.25e18, "the master burns a quarter");
        assertEq(wnt.balanceOf(_account(_a)), 108e18, "A's 100 at 1.1, less a tenth of its 10 gain and one fee");
        assertEq(wnt.balanceOf(_account(_b)), 53.5e18, "B's 50 at 1.1, less a tenth of its 5 gain and one fee");
        assertEq(
            wnt.balanceOf(_ownerAccount()), 137.575e18, "the master's 124.75 at 1.1 with no fee, plus 1.35 of the backers' fees, less one fee"
        );
        assertEq(wnt.balanceOf(feeReceiver) - _fees, 3e18, "the fee receiver takes the three fee slices");
        assertEq(wnt.balanceOf(protocolReceiver), 0.15e18, "and the protocol receiver A's 0.1 and B's 0.05 cuts");
        _assertClosed();
    }

    function test_everyone_pays_the_queue_in_full_and_a_fraction_of_the_rest() public {
        _open();
        (address _a, uint _aKey) = _back("eq-a", 401e6, 1e12);
        _sell(_a, _aKey, 100e18);
        _redeemAt(5000, 0, 1e12, _list(_account(_a)));
        assertEq(shareToken.balanceOf(_account(_a)), 150e18, "A burns its queued 100 and half of its free 300");
        assertEq(_queuedOf(_account(_a)), 0);
        assertEq(wnt.balanceOf(_account(_a)), 249e18, "and is paid all 250 less one fee");
        assertEq(shareToken.balanceOf(body), 249.5e18);
        assertEq(wnt.balanceOf(_ownerAccount()), 248.5e18);
        _assertClosed();
    }

    function test_a_redemption_pays_every_stake_in_its_named_canonical_token_at_the_valuation_line_price() public {
        _open();
        (address _a,) = _back("usdc-a", 401e6, 1e12);
        address[] memory _holders = _list(_account(_a));
        vm.startPrank(body);
        wnt.transfer(makeAddr("swapped-weth"), wnt.balanceOf(body));
        vm.stopPrank();
        uint _held = usdc.balanceOf(body);
        assertEq(_held, 899e6, "the fund holds its capital in USDC");
        Fund.Valuation memory _v;
        _v.assetList = new Fund.Asset[](1);
        _v.assetList[0] = Fund.Asset({chainId: block.chainid, token: address(usdc), id: 0, amount: _held, value: _held * 1e12});
        _v.positionList = new Fund.Position[](0);
        Redeem.RedeemIntent memory _i = _redeemIntent(2500, 0, _v);
        _i.token = address(usdc);
        _i.header.feeToken = address(usdc);
        _i.header.fee = FEE;
        uint _backer = usdc.balanceOf(_account(_a));
        uint _wallet = usdc.balanceOf(_ownerAccount());
        uint _fees = usdc.balanceOf(feeReceiver);
        hub.redeem(_i, _redeemSig(_i), _holders);
        assertEq(usdc.balanceOf(_account(_a)) - _backer, 99e6, "the backer's quarter is paid in USDC at the line's price, less one fee");
        assertEq(usdc.balanceOf(_ownerAccount()) - _wallet, 123.75e6, "the master's quarter too, paid last");
        assertEq(usdc.balanceOf(feeReceiver) - _fees, 2 * FEE, "each recipient's fee is billed in USDC");
        assertEq(usdc.balanceOf(body), _held - 224.75e6, "the fund pays out of its USDC");
        assertEq(usdc.balanceOf(address(fundStore)), 0, "and the store keeps none of it");
        assertEq(shareToken.balanceOf(_account(_a)), 300e18, "the backer burns a quarter");
        assertEq(shareToken.balanceOf(body), 374.25e18, "as does the master");
        assertEq(fundStore.getRedemption(body).token, address(usdc), "the redemption names its payout token");
        assertEq(fundStore.getRedemption(body).price, 1e12, "and prices a share in value at the line's rate");
        assertFalse(isOpen(fundStore.getRedemption(body)), "and closes");

        _i = _redeemIntent(2500, 0, _v);
        _i.token = address(outToken);
        _i.header.feeToken = address(outToken);
        bytes memory _sig = _redeemSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__TokenNotCanonical.selector, address(outToken)));
        hub.redeem(_i, _sig, _holders);

        _i = _redeemIntent(2500, 0, _v);
        _i.token = address(usdc);
        _sig = _redeemSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Intent__FeeTokenMismatch.selector, address(wnt), address(usdc)));
        hub.redeem(_i, _sig, _holders);
    }

    function test_a_payout_token_is_priced_by_its_own_hub_line_beside_others_and_needs_one() public {
        _open();
        (address _a,) = _back("mixed-a", 401e6, 1e12);
        address[] memory _holders = _list(_account(_a));
        vm.startPrank(body);
        wnt.transfer(makeAddr("swapped-weth"), wnt.balanceOf(body) - 100e18);
        vm.stopPrank();

        Fund.Valuation memory _unpriced;
        _unpriced.assetList = new Fund.Asset[](3);
        _unpriced.assetList[0] = Fund.Asset({chainId: block.chainid, token: address(wnt), id: 0, amount: 100e18, value: 100e18});
        _unpriced.assetList[1] = Fund.Asset({chainId: FOREIGN_CHAIN_ID, token: address(usdc), id: 0, amount: 899e6, value: 899e18});
        _unpriced.assetList[2] = Fund.Asset({chainId: block.chainid, token: address(usdc), id: 1, amount: 899e6, value: 899e18});
        _unpriced.positionList = new Fund.Position[](0);
        Redeem.RedeemIntent memory _i = _redeemIntent(2500, 0, _unpriced);
        _i.token = address(usdc);
        _i.header.feeToken = address(usdc);
        _i.header.fee = FEE;
        bytes memory _sig = _redeemSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Redeem__TokenUnpriced.selector, address(usdc)));
        hub.redeem(_i, _sig, _holders);

        Fund.Valuation memory _v;
        _v.assetList = new Fund.Asset[](2);
        _v.assetList[0] = Fund.Asset({chainId: block.chainid, token: address(wnt), id: 0, amount: 100e18, value: 100e18});
        _v.assetList[1] = Fund.Asset({chainId: block.chainid, token: address(usdc), id: 0, amount: 899e6, value: 899e18});
        _v.positionList = new Fund.Position[](0);
        _i = _redeemIntent(2500, 0, _v);
        _i.token = address(usdc);
        _i.header.feeToken = address(usdc);
        _i.header.fee = FEE;
        uint _backer = usdc.balanceOf(_account(_a));
        uint _wallet = usdc.balanceOf(_ownerAccount());
        uint _fees = usdc.balanceOf(feeReceiver);
        hub.redeem(_i, _redeemSig(_i), _holders);
        assertEq(
            fundStore.getRedemption(body).price,
            1_111_234_705_104,
            "the whole fund's value per share, the WETH line included, read through the USDC line"
        );
        assertEq(
            usdc.balanceOf(_account(_a)) - _backer,
            109_011_123,
            "the backer's quarter at the USDC line's price, less a tenth of its gain and one fee"
        );
        assertEq(usdc.balanceOf(_ownerAccount()) - _wallet, 138_627_642, "and the master's with its part of the backer's fee, paid last");
        assertEq(usdc.balanceOf(feeReceiver) - _fees, 2 * FEE, "the fee receiver takes the two fee slices in USDC");
        assertEq(usdc.balanceOf(protocolReceiver), 111_234, "and the protocol receiver the backer's cut, in USDC");
        assertEq(usdc.balanceOf(body), 899e6 - 249_749_999, "paid out of the fund's USDC");
        assertEq(wnt.balanceOf(body), 100e18, "while its WETH stays");
    }

    function test_a_sell_into_an_open_usdc_redemption_settles_the_seller_first_in_usdc() public {
        _open();
        (address _a, uint _aKey) = _back("us-a", 401e6, 1e12);
        (address _b, uint _bKey) = _back("us-b", 201e6, 1e12);
        address _aAcct = _account(_a);
        _sell(_a, _aKey, 100e18);
        _sell(_b, _bKey, 50e18);
        vm.startPrank(body);
        wnt.transfer(makeAddr("swapped-weth"), wnt.balanceOf(body));
        vm.stopPrank();
        uint _held = usdc.balanceOf(body);
        assertEq(_held, 1099e6, "the fund holds its capital in USDC");
        Fund.Valuation memory _v;
        _v.assetList = new Fund.Asset[](1);
        _v.assetList[0] = Fund.Asset({chainId: block.chainid, token: address(usdc), id: 0, amount: _held, value: _held * 1e12});
        _v.positionList = new Fund.Position[](0);
        Redeem.RedeemIntent memory _i = _redeemIntent(0, 0, _v);
        _i.token = address(usdc);
        _i.header.feeToken = address(usdc);
        _i.header.fee = FEE;
        hub.redeem(_i, _redeemSig(_i), new address[](0));
        assertEq(fundStore.getRedemption(body).potLeft, 150e6, "the queue's pot is ring-fenced in USDC");
        assertEq(usdc.balanceOf(address(fundStore)), 150e6, "and held by the store");
        _assertBooked();

        uint _before = usdc.balanceOf(_aAcct);
        _sell(_a, _aKey, 50e18);
        assertEq(usdc.balanceOf(_aAcct) - _before, 100e6 - FEE, "the sell pays A's open claim in USDC first, less its own relay fee");
        assertEq(fundStore.getRedemption(body).potLeft, 50e6, "leaving B's part in the pot");
        assertEq(usdc.balanceOf(address(fundStore)), 50e6, "and in the store");
        assertEq(fundStore.bookedMap(body, address(usdc)), 50e6, "and in the fund's booking");
        assertEq(_queuedOf(_aAcct), 50e18, "A's new 50 waits for the next redemption");
    }

    function test_two_funds_redeeming_in_different_tokens_are_paid_apart_from_the_one_store() public {
        _open();
        (address _a,) = _back("iso-a", 401e6, 1e12);
        vm.startPrank(body);
        wnt.transfer(makeAddr("swapped-weth"), wnt.balanceOf(body));
        vm.stopPrank();
        Fund.Valuation memory _v;
        _v.assetList = new Fund.Asset[](1);
        _v.assetList[0] = Fund.Asset({chainId: block.chainid, token: address(usdc), id: 0, amount: 899e6, value: 899e18});
        _v.positionList = new Fund.Position[](0);
        Redeem.RedeemIntent memory _i = _redeemIntent(2500, 0, _v);
        _i.token = address(usdc);
        _i.header.feeToken = address(usdc);
        _i.header.fee = FEE;
        hub.redeem(_i, _redeemSig(_i), new address[](0));
        ShareToken _usdcFund = shareToken;
        address _usdcMaster = master;
        address _usdcBody = body;

        _openSecondFund();
        (address _b,) = _back("iso-b", 201e6, 1e12);
        _sellUsdcAway();
        vm.startPrank(body);
        wnt.transfer(makeAddr("swapped-weth"), wnt.balanceOf(body) - 699e18);
        vm.stopPrank();
        _v.assetList[0] = Fund.Asset({chainId: block.chainid, token: address(wnt), id: 0, amount: 699e18, value: 699e18});
        _i = _redeemIntent(2500, 0, _v);
        hub.redeem(_i, _redeemSig(_i), new address[](0));
        assertEq(usdc.balanceOf(address(fundStore)), 224.75e6, "the store ring-fences the USDC fund's pot and master pay");
        assertEq(wnt.balanceOf(address(fundStore)), 174.75e18, "beside the WETH fund's");
        assertEq(fundStore.bookedMap(_usdcBody, address(usdc)), 224.75e6, "each fund books its own pot and master pay");
        assertEq(fundStore.bookedMap(body, address(wnt)), 174.75e18, "in its own payout token");
        assertEq(
            fundStore.bookedMap(_usdcBody, address(wnt)) + fundStore.bookedMap(body, address(usdc)),
            0,
            "and nothing in the other's"
        );

        uint _bUsdc = usdc.balanceOf(_account(_b));
        uint _bWeth = wnt.balanceOf(_account(_b));
        uint _feeUsdc = usdc.balanceOf(feeReceiver);
        uint _feeWeth = wnt.balanceOf(feeReceiver);
        uint _wallet = wnt.balanceOf(_ownerAccount());
        hub.redeemCohort(shareToken, _list(_account(_b)));
        assertEq(wnt.balanceOf(_account(_b)) - _bWeth, 49e18, "the WETH fund pays its backer in WETH");
        assertEq(usdc.balanceOf(_account(_b)), _bUsdc, "and nothing in USDC");
        assertEq(wnt.balanceOf(_ownerAccount()) - _wallet, 123.75e18, "and its master last, in WETH");
        assertEq(wnt.balanceOf(address(fundStore)), 0, "emptying its WETH from the store");
        assertEq(fundStore.bookedMap(body, address(wnt)), 0, "and its booking");
        assertEq(usdc.balanceOf(address(fundStore)), 224.75e6, "without touching the USDC fund's");
        assertEq(fundStore.bookedMap(_usdcBody, address(usdc)), 224.75e6, "nor its booking");

        uint _aUsdc = usdc.balanceOf(_account(_a));
        uint _aWeth = wnt.balanceOf(_account(_a));
        _wallet = usdc.balanceOf(accountModule.predictUserAccount(_usdcMaster));
        hub.redeemCohort(_usdcFund, _list(_account(_a)));
        assertEq(usdc.balanceOf(_account(_a)) - _aUsdc, 99e6, "the USDC fund pays its backer in USDC");
        assertEq(wnt.balanceOf(_account(_a)), _aWeth, "and nothing in WETH");
        assertEq(usdc.balanceOf(accountModule.predictUserAccount(_usdcMaster)) - _wallet, 123.75e6, "and its master last, in USDC");
        assertEq(usdc.balanceOf(address(fundStore)), 0, "emptying the store");
        assertEq(fundStore.bookedMap(_usdcBody, address(usdc)), 0, "and the USDC fund's booking");
        assertEq(usdc.balanceOf(feeReceiver) - _feeUsdc, 2 * FEE, "each cohort pays its fees in its own token");
        assertEq(wnt.balanceOf(feeReceiver) - _feeWeth, 2 * FEE * USD);
    }

    function test_the_open_books_exactly_its_pot_and_master_pay_and_every_payment_draws_that_booking_down_to_zero()
        public
    {
        _open();
        (address _a, uint _aKey) = _back("bk-a", 401e6, 1e12);
        (address _b, uint _bKey) = _back("bk-b", 201e6, 0.5e12);
        (address _c,) = _back("bk-c", 11e6, 1e12);
        address _aAcct = _account(_a);
        address _bAcct = _account(_b);
        address _cAcct = _account(_c);
        _sell(_a, _aKey, 100e18);
        uint _cash = wnt.balanceOf(body);

        _redeemAt(1000, 0, 1e12, new address[](0));
        assertEq(
            fundStore.bookedMap(body, address(wnt)),
            220.9e18,
            "the open books the queue's 100 and a tenth of the active 710, beside the master's 49.9"
        );
        _assertBooked();
        assertEq(fundStore.bookedMap(body, address(usdc)), 0, "in its payout token alone");
        assertEq(fundStore.heldMap(address(wnt)), 220.9e18, "the store owes exactly that");
        assertEq(wnt.balanceOf(address(fundStore)), 220.9e18, "and holds it");
        assertEq(_cash - wnt.balanceOf(body), 220.9e18, "out of the fund's cash");
        assertEq(shareToken.pendingBurn(), 171e18, "the open budgets the queue and a tenth of the active shares to burn");

        _sell(_b, _bKey, 10e18);
        assertEq(wnt.balanceOf(_bAcct), 38e18, "a sell settles B's tenth first, 40 less a tenth of its 20 gain");
        assertEq(wnt.balanceOf(protocolReceiver), 0.2e18);
        assertEq(
            fundStore.bookedMap(body, address(wnt)),
            182.7e18,
            "drawing the booking down by what it paid out, while the master's part of the fee stays booked"
        );
        _assertBooked();
        assertEq(shareToken.pendingBurn(), 131e18, "and burning B's tenth out of the budget");

        uint _fundCash = wnt.balanceOf(body);
        hub.redeemCohort(shareToken, _list(_cAcct));
        assertEq(wnt.balanceOf(_cAcct), 0, "C's tenth is worth one fee, so it is cut");
        assertEq(wnt.balanceOf(body) - _fundCash, 1e18, "back to the fund");
        assertEq(fundStore.bookedMap(body, address(wnt)), 181.7e18, "and out of the booking");
        _assertBooked();

        uint _fees = wnt.balanceOf(feeReceiver);
        hub.redeemCohort(shareToken, _list(_aAcct));
        assertEq(wnt.balanceOf(_aAcct), 129e18, "A is paid its queued 100 and its tenth of 300, less one fee");
        assertEq(
            wnt.balanceOf(_ownerAccount()),
            50.7e18,
            "the close-out pays the owner's account the master's 49.9 and 1.8 of B's fee, less one fee"
        );
        assertEq(wnt.balanceOf(feeReceiver) - _fees, 2e18, "the fee receiver takes A's fee slice and the master's");
        assertEq(shareToken.pendingBurn(), 1e18, "C's cut tenth stays unburned");
        _assertClosed();
    }

    function test_a_fund_never_pays_beyond_its_own_booking_while_another_funds_pot_in_the_same_token_sits_in_the_store()
        public
    {
        _open();
        (address _a, uint _aKey) = _back("ub-a", 401e6, 1e12);
        address _aAcct = _account(_a);
        _sell(_a, _aKey, 100e18);
        _redeemAt(0, 0, 1e12, new address[](0));
        address _firstBody = body;
        ShareToken _firstShare = shareToken;

        _openSecondFund();
        (address _b, uint _bKey) = _back("ub-b", 201e6, 1e12);
        address _bAcct = _account(_b);
        _sell(_b, _bKey, 50e18);
        _redeemAt(0, 0, 1e12, new address[](0));
        assertEq(fundStore.bookedMap(_firstBody, address(wnt)), 100e18, "the first fund books its queue's pot");
        assertEq(fundStore.bookedMap(body, address(wnt)), 50e18, "the second its own, in the same token");
        assertEq(wnt.balanceOf(address(fundStore)), 150e18, "so the store holds both pots in one balance");

        vm.expectRevert(abi.encodeWithSelector(Error.FundStore__Unbooked.selector, body, address(wnt), 50e18, 50e18 + 1));
        vm.prank(address(redeemModule));
        fundStore.pay(body, address(wnt), _bAcct, 50e18 + 1, 200_000);

        FundStore.Redemption memory _booked = fundStore.getRedemption(body);
        FundStore.Redemption memory _inflated = fundStore.getRedemption(body);
        _inflated.potLeft = 150e18;
        vm.prank(address(redeemModule));
        fundStore.setRedemption(body, _inflated);
        vm.expectRevert(abi.encodeWithSelector(Error.FundStore__Unbooked.selector, body, address(wnt), 50e18, 149e18));
        hub.redeemCohort(shareToken, _list(_bAcct));
        assertEq(wnt.balanceOf(address(fundStore)), 150e18, "a cohort whose pot outgrows its booking cannot reach the first fund's");

        vm.prank(address(redeemModule));
        fundStore.setRedemption(body, _booked);
        hub.redeemCohort(shareToken, _list(_bAcct));
        assertEq(wnt.balanceOf(_bAcct), 49e18, "the second fund pays its seller out of its own booking");
        assertEq(fundStore.bookedMap(body, address(wnt)), 0, "spending it");
        assertEq(fundStore.bookedMap(_firstBody, address(wnt)), 100e18, "while the first fund's stays whole");
        assertEq(wnt.balanceOf(address(fundStore)), 100e18, "beside its tokens");

        hub.redeemCohort(_firstShare, _list(_aAcct));
        assertEq(wnt.balanceOf(_aAcct), 99e18, "and the first fund still pays its own seller in full");
        assertEq(fundStore.bookedMap(_firstBody, address(wnt)), 0);
        assertEq(fundStore.heldMap(address(wnt)), 0, "leaving the store owing nothing");
        assertEq(wnt.balanceOf(address(fundStore)), 0, "and holding nothing");
    }

    function test_a_booking_the_store_never_received_reverts_the_open_even_while_it_holds_another_funds_pot() public {
        _open();
        (address _a, uint _aKey) = _back("uf-a", 401e6, 1e12);
        _sell(_a, _aKey, 100e18);
        _redeemAt(0, 0, 1e12, new address[](0));
        assertEq(fundStore.heldMap(address(wnt)), 100e18, "the store owes the first fund's pot");

        _openSecondFund();
        (address _b, uint _bKey) = _back("uf-b", 201e6, 1e12);
        _sell(_b, _bKey, 50e18);
        Redeem.RedeemIntent memory _i = _intentAt(0, 0, 1e12);
        bytes memory _sig = _redeemSig(_i);
        vm.mockCall(address(wnt), abi.encodeWithSelector(IERC20.transfer.selector, address(fundStore)), abi.encode(true));
        vm.expectRevert(abi.encodeWithSelector(Error.FundStore__Unfunded.selector, address(wnt), 100e18, 150e18));
        hub.redeem(_i, _sig, new address[](0));
        vm.clearMockedCalls();

        hub.redeem(_i, _sig, new address[](0));
        assertEq(fundStore.bookedMap(body, address(wnt)), 50e18, "once the pot arrives the open books it");
        assertEq(fundStore.heldMap(address(wnt)), 150e18, "beside the first fund's");
        assertEq(wnt.balanceOf(address(fundStore)), 150e18, "and the store holds both");

        vm.expectRevert(abi.encodeWithSelector(Error.FundStore__Unfunded.selector, address(wnt), 150e18, 150e18 + 1));
        vm.prank(address(redeemModule));
        fundStore.book(body, address(wnt), 1);
    }

    function test_a_usdc_partial_exit_pays_the_masters_part_and_every_fee_in_usdc_on_the_hub() public {
        _open();
        (address _a,) = _back("usr-a", 401e6, 1e12);
        (address _b,) = _back("usr-b", 201e6, 1e12);
        vm.startPrank(body);
        wnt.transfer(makeAddr("swapped-weth"), wnt.balanceOf(body));
        vm.stopPrank();
        Fund.Valuation memory _v;
        _v.assetList = new Fund.Asset[](1);
        _v.assetList[0] = Fund.Asset({chainId: block.chainid, token: address(usdc), id: 0, amount: 1099e6, value: 1099e18});
        _v.positionList = new Fund.Position[](1);
        _v.positionList[0] =
            Fund.Position({chainId: FOREIGN_CHAIN_ID, venue: bytes32("GMX"), id: keccak256("position-a"), value: 549.5e18});
        Redeem.RedeemIntent memory _i = _redeemIntent(5000, 0, _v);
        _i.token = address(usdc);
        _i.header.feeToken = address(usdc);
        _i.header.fee = FEE;
        uint _aBefore = usdc.balanceOf(_account(_a));
        uint _bBefore = usdc.balanceOf(_account(_b));
        uint _wallet = usdc.balanceOf(_ownerAccount());
        uint _fees = usdc.balanceOf(feeReceiver);
        hub.redeem(_i, _redeemSig(_i), _list(_account(_a), _account(_b)));

        uint _base = 1099e18 + VIRTUAL_SHARES;
        uint _nav = Math.mulDiv(1648.5e18 + VIRTUAL_VALUE, 1099e6, 1099e18);
        uint _price = Math.mulDiv(_nav * PRICE_PRECISION, 1099e18, 1099e6 * _base);
        assertEq(fundStore.getRedemption(body).price, _price, "the open prices a share in value, the spoke position included");
        uint _pot = Math.mulDiv(600e18 * 5000, _nav, _base * 10_000);
        uint _masterPart = Math.mulDiv(249.5e18, _nav, _base);
        uint _aPayout = Math.mulDiv(_pot, 2, 3);
        uint _aFee = Math.mulDiv(_aPayout, PERFORMANCE_FEE * (_price - 1e12), _price * 10_000);
        uint _bFee = Math.mulDiv(_pot - _aPayout, PERFORMANCE_FEE * (_price - 1e12), _price * 10_000);
        uint _cuts = _aFee * PROTOCOL_FEE_SHARE / 10_000 + _bFee * PROTOCOL_FEE_SHARE / 10_000;
        assertEq(
            usdc.balanceOf(_account(_a)) - _aBefore,
            _aPayout - _aFee - FEE,
            "A is paid its half at that price in USDC, less a tenth of its gain and one fee"
        );
        assertEq(usdc.balanceOf(_account(_b)) - _bBefore, _pot - _aPayout - _bFee - FEE, "B too");
        assertEq(
            usdc.balanceOf(_ownerAccount()) - _wallet,
            _masterPart + _aFee + _bFee - _cuts - FEE,
            "the master's half is paid on the hub in USDC at the open's price, with the backers' fee parts, less one fee"
        );
        assertEq(usdc.balanceOf(feeReceiver) - _fees, 3 * FEE, "every fee slice is paid in USDC to the fee receiver");
        assertEq(usdc.balanceOf(protocolReceiver), _cuts, "and every protocol cut to the protocol receiver");
        assertEq(usdc.balanceOf(body), 1099e6 - _pot - _masterPart, "out of the fund's hub USDC");
        assertEq(shareToken.balanceOf(body), 249.5e18, "the master's half burned at the open");
        _assertClosed();
    }

    function test_a_full_usdc_exit_needs_all_hub_value_in_usdc_and_pays_it_all_out() public {
        _open();
        (address _a,) = _back("ufx-a", 401e6, 1e12);
        (address _b,) = _back("ufx-b", 201e6, 1e12);
        Fund.Valuation memory _v;
        _v.assetList = new Fund.Asset[](2);
        _v.assetList[0] = Fund.Asset({chainId: block.chainid, token: address(usdc), id: 0, amount: 1099e6, value: 1099e18});
        _v.assetList[1] = Fund.Asset({chainId: block.chainid, token: address(wnt), id: 0, amount: 10_000e18, value: 10_000e18});
        _v.positionList = new Fund.Position[](0);
        Redeem.RedeemIntent memory _i = _redeemIntent(10_000, 0, _v);
        _i.token = address(usdc);
        _i.header.feeToken = address(usdc);
        _i.header.fee = FEE;
        bytes memory _sig = _redeemSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientFund.selector, address(usdc), 1099e6, 11_099e6));
        hub.redeem(_i, _sig, new address[](0));

        vm.startPrank(body);
        wnt.transfer(makeAddr("swapped-weth"), wnt.balanceOf(body));
        vm.stopPrank();
        _v.assetList = new Fund.Asset[](1);
        _v.assetList[0] = Fund.Asset({chainId: block.chainid, token: address(usdc), id: 0, amount: 1099e6, value: 1099e18});
        _i = _redeemIntent(10_000, 0, _v);
        _i.token = address(usdc);
        _i.header.feeToken = address(usdc);
        _i.header.fee = FEE;
        uint _aBefore = usdc.balanceOf(_account(_a));
        uint _bBefore = usdc.balanceOf(_account(_b));
        uint _fees = usdc.balanceOf(feeReceiver);
        uint _wallet = usdc.balanceOf(_ownerAccount());
        hub.redeem(_i, _redeemSig(_i), _list(_account(_a), _account(_b)));
        assertEq(usdc.balanceOf(_account(_a)) - _aBefore, 399e6, "A is paid 400/1099 of the hub USDC less one fee");
        assertEq(usdc.balanceOf(_account(_b)) - _bBefore, 199e6);
        assertEq(usdc.balanceOf(_ownerAccount()) - _wallet, 498e6, "the master everything else, last");
        assertEq(usdc.balanceOf(feeReceiver) - _fees, 3e6);
        assertEq(shareToken.totalSupply(), 0, "every share burned");
        assertEq(usdc.balanceOf(body), 0, "and the hub USDC paid out in full");
        _assertClosed();
    }

    function test_invalid_opens_revert_with_their_arguments() public {
        _open();
        (address _a, uint _aKey) = _back("inv-a", 401e6, 1e12);
        address[] memory _none = new address[](0);

        Redeem.RedeemIntent memory _i = _intentAt(10_001, 0, 1e12);
        bytes memory _sig = _redeemSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Redeem__InvalidMode.selector, 10_001, 0));
        hub.redeem(_i, _sig, _none);

        _i = _intentAt(1, 1, 1e12);
        _sig = _redeemSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Redeem__InvalidMode.selector, 1, 1));
        hub.redeem(_i, _sig, _none);

        _i = _intentAt(0, 0, 1e12);
        _sig = _redeemSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.redeem(_i, _sig, _none);

        _sell(_a, _aKey, 100e18);
        _i = _intentAt(0, 500e18, 1e12);
        _sig = _redeemSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__InsufficientShares.selector, 499e18, 500e18));
        hub.redeem(_i, _sig, _none);

        _i = _intentAt(0, 0, 1e12);
        _i.header.feeToken = address(usdc);
        _sig = _redeemSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Intent__FeeTokenMismatch.selector, address(usdc), address(wnt)));
        hub.redeem(_i, _sig, _none);

        _redeemAt(0, 0, 1e12, _none);
        uint64 _id = fundStore.getRedemption(body).id;
        _i = _intentAt(2500, 0, 1e12);
        _sig = _redeemSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Redeem__Open.selector, _id));
        hub.redeem(_i, _sig, _none);
    }

    function test_the_master_is_paid_only_after_every_other_claim_settles() public {
        _open();
        (address _a,) = _back("ml-a", 401e6, 1e12);
        (address _b,) = _back("ml-b", 201e6, 1e12);
        _redeemAt(2000, 0, 1e12, _list(_account(_a)));
        assertEq(wnt.balanceOf(_account(_a)), 79e18);
        assertEq(wnt.balanceOf(_ownerAccount()), 0, "the master waits while B is owed");
        assertEq(shareToken.balanceOf(body), 399.2e18, "though its fifth burned at the open");
        FundStore.Redemption memory _r = fundStore.getRedemption(body);
        assertEq(_r.masterPay, 99.8e18);
        assertTrue(isOpen(_r));

        hub.redeemCohort(shareToken, _list(_account(_b)));
        assertEq(wnt.balanceOf(_account(_b)), 39e18);
        assertEq(wnt.balanceOf(_ownerAccount()), 98.8e18, "and is paid in the cohort that settles the last claim");
        _assertClosed();
    }

    function test_a_sell_that_settles_the_last_claim_leaves_the_master_for_an_empty_cohort() public {
        _open();
        (address _a, uint _aKey) = _back("le-a", 401e6, 1e12);
        _redeemAt(2000, 0, 1e12, new address[](0));
        _sell(_a, _aKey, 10e18);
        assertEq(wnt.balanceOf(_account(_a)), 80e18, "the sell settles A's fifth first");
        FundStore.Redemption memory _r = fundStore.getRedemption(body);
        assertEq(_r.owedLeft, 0, "nobody else is owed");
        assertTrue(isOpen(_r), "but the master's pay keeps it open");
        assertEq(wnt.balanceOf(_ownerAccount()), 0);

        hub.redeemCohort(shareToken, new address[](0));
        assertEq(wnt.balanceOf(_ownerAccount()), 98.8e18, "an empty cohort pays the master");
        assertEq(fundStore.getRedemption(body).queued, 10e18, "A's new sale waits for the next redemption");
        _assertClosed();
    }

    function test_a_sell_ends_the_sellers_mandate_and_payee_for_that_fund_and_keeps_its_others() public {
        _open();
        (address _a, uint _aKey) = _back("md-a", 401e6, 1e12);
        address _aAcct = _account(_a);
        MandateLib.Mandate[] memory _elsewhere = new MandateLib.Mandate[](1);
        _elsewhere[0] = MandateLib.Mandate({
            master: makeAddr("another-fund"),
            skin: MAX_SKIN,
            allocationRate: 2500,
            exitCap: 5000,
            cooldownPeriod: 1 days,
            expiry: block.timestamp + 30 days
        });
        _mandate(_a, _aKey, _elsewhere);
        assertEq(
            mandateStore.mandateMap(_aAcct, body),
            keccak256(abi.encode(mandateLog[_aAcct][body], UserAccount(payable(_aAcct)).epoch())),
            "the hub holds the backer's live mandate for the fund"
        );

        _sell(_a, _aKey, 100e18);
        assertEq(mandateStore.mandateMap(_aAcct, body), bytes32(0), "a sell clears the seller's mandate for that fund");
        assertEq(
            mandateStore.mandateMap(_aAcct, _elsewhere[0].master),
            keccak256(abi.encode(_elsewhere[0], UserAccount(payable(_aAcct)).epoch())),
            "and leaves its mandate for another fund as it was"
        );

        (address _c, uint _cKey) = makeAddrAndKey("md-c");
        _fundWallet(_c, 410e6);
        MandateLib.Mandate[] memory _one = new MandateLib.Mandate[](1);
        _one[0] = MandateLib.Mandate({
            master: body, skin: MAX_SKIN, allocationRate: 5000, exitCap: 10_000, cooldownPeriod: 0, expiry: block.timestamp + 365 days
        });
        _mandate(_c, _cKey, _one);
        address _cAcct = _account(_c);
        Fund.Allocation[] memory _rows = new Fund.Allocation[](2);
        (_rows[0], _rows[1]) = uint160(_aAcct) < uint160(_cAcct)
            ? (_row(_aAcct, 100e6), _row(_cAcct, 100e6))
            : (_row(_cAcct, 100e6), _row(_aAcct, 100e6));
        uint _aShares = shareToken.balanceOf(_aAcct);
        uint _aCash = usdc.balanceOf(_aAcct);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(_nonceOf(body), _nav(), _rows);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(_aAcct), _aShares, "so the next round skips the seller");
        assertEq(usdc.balanceOf(_aAcct), _aCash, "and pulls nothing from it");
        assertGt(shareToken.balanceOf(_cAcct), 0, "while it still mints a backer whose mandate is live");
    }

    function test_a_dust_claim_is_cut_back_to_the_fund_and_keeps_its_shares_and_queue() public {
        _open();
        (address _a, uint _aKey) = _back("d-a", 401e6, 1e12);
        (address _b, uint _bKey) = _back("d-b", 201e6, 1e12);
        _sell(_a, _aKey, 100e18);
        _sell(_b, _bKey, 0.5e18);
        address[] memory _cohort = _list(_account(_b), _account(_a));
        uint _fees = wnt.balanceOf(feeReceiver);
        uint _cash = wnt.balanceOf(body);
        _redeemAt(0, 0, 1e12, _cohort);
        assertEq(wnt.balanceOf(_cohort[0]), 0, "a claim worth at most one fee pays the holder nothing");
        assertEq(shareToken.balanceOf(_cohort[0]), 200e18, "and burns none of its shares");
        assertEq(_queuedOf(_cohort[0]), 0.5e18, "so it keeps its place in the queue");
        assertEq(wnt.balanceOf(_cohort[1]), 99e18);
        assertEq(wnt.balanceOf(feeReceiver) - _fees, 1e18, "the fee receiver takes only A's fee");
        assertEq(_cash - wnt.balanceOf(body), 100e18, "and the dust claim's part comes back to the fund");
        assertEq(fundStore.getRedemption(body).queued, 0.5e18);
        _assertClosed();
    }

    function test_a_dust_claim_at_a_gain_is_cut_without_a_fee_and_keeps_its_shares() public {
        _open();
        (address _a, uint _aKey) = _back("dg-a", 401e6, 1e12);
        (address _b, uint _bKey) = _back("dg-b", 201e6, 1e12);
        _sell(_a, _aKey, 100e18);
        _sell(_b, _bKey, 0.5e18);
        address[] memory _cohort = _list(_account(_b), _account(_a));
        uint _fees = wnt.balanceOf(feeReceiver);
        uint _cash = wnt.balanceOf(body);
        _redeemAt(0, 0, 1.2e12, _cohort);
        assertEq(wnt.balanceOf(_cohort[0]), 0, "B's 0.6 less its 0.01 fee is at most one fee, so B is cut");
        assertEq(shareToken.balanceOf(_cohort[0]), 200e18, "and keeps its shares");
        assertEq(wnt.balanceOf(_cohort[1]), 117e18);
        assertEq(wnt.balanceOf(_ownerAccount()), 0.8e18, "the master takes its 1.8 of A's fee, less one fee, and nothing of B's");
        assertEq(wnt.balanceOf(feeReceiver) - _fees, 2e18, "the fee receiver takes A's fee slice and the master's");
        assertEq(wnt.balanceOf(protocolReceiver), 0.2e18, "and the protocol receiver only A's 0.2 cut");
        assertEq(_cash - wnt.balanceOf(body), 120e18, "B's 0.6 comes back to the fund");
        _assertClosed();
    }

    function test_value_a_body_holds_before_its_first_shares_is_minted_to_the_master() public {
        _escrowOnHub(address(usdc), 500e6);
        _wethTo(body, 1 ether);
        bytes32 _symbol = bytes32("EXV");
        bytes memory _pixels = new bytes(GRID_BYTES);
        shareToken = ShareToken(
            address(
                uint160(
                    uint(
                        keccak256(
                            abi.encodePacked(
                                bytes1(0xff),
                                address(hub),
                                bytes32(uint(uint160(body))),
                                keccak256(
                                    _cloneCode(
                                        fundModule.shareImpl(), abi.encodePacked(body, _symbol, _pixels, uint16(PERFORMANCE_FEE))
                                    )
                                )
                            )
                        )
                    )
                )
            )
        );
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(0, 1e6, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), body, _account(master));
        hub.createFund(_symbol, _pixels, _coSig(bodyKey, _genesis), _fundApproval(masterKey, body), _i, _sig, _ownerCoSig(_i));
        assertEq(
            shareToken.balanceOf(body),
            500e18,
            "the master is minted the 1 the body already held beside its 499 credit, at one share per unit"
        );
        (address _a,) = _back("vh-a", 101e6, 1e12);
        assertEq(shareToken.balanceOf(_account(_a)), 100e18, "so a backer joins at that same price, owning none of it");
    }

    function test_identical_dust_claims_get_identical_outcomes_in_any_list_order() public {
        _open();
        (address _a, uint _aKey) = _back("o-a", 401e6, 1e12);
        (address _b, uint _bKey) = _back("o-b", 201e6, 1e12);
        (address _c, uint _cKey) = _back("o-c", 201e6, 1e12);
        _sell(_a, _aKey, 100e18);
        _sell(_b, _bKey, 0.6e18);
        _sell(_c, _cKey, 0.6e18);
        address[] memory _cohort = _list3(_account(_b), _account(_a), _account(_c));
        uint _fees = wnt.balanceOf(feeReceiver);
        uint _cash = wnt.balanceOf(body);
        _redeemAt(0, 0, 1e12, _cohort);
        assertEq(wnt.balanceOf(_cohort[1]), 99e18);
        assertEq(wnt.balanceOf(_cohort[0]), 0, "B, listed while the pot is above one fee, is paid nothing");
        assertEq(wnt.balanceOf(_cohort[2]), 0, "as C, reached once the pot is down to one fee");
        assertEq(shareToken.balanceOf(_cohort[0]), 200e18, "and B keeps its shares");
        assertEq(shareToken.balanceOf(_cohort[2]), 200e18, "as C does");
        assertEq(_queuedOf(_cohort[0]), 0.6e18, "and its place in the queue");
        assertEq(_queuedOf(_cohort[2]), 0.6e18);
        assertEq(wnt.balanceOf(feeReceiver) - _fees, 1e18, "neither dust claim pays the fee receiver");
        assertEq(_cash - wnt.balanceOf(body), 100e18, "both come back to the fund");
        _assertClosed();
    }

    function test_a_tail_worth_at_most_one_fee_is_cut_back_to_the_fund_and_keeps_its_claims() public {
        _open();
        (address _a, uint _aKey) = _back("t-a", 401e6, 1e12);
        (address _b, uint _bKey) = _back("t-b", 201e6, 1e12);
        (address _c, uint _cKey) = _back("t-c", 201e6, 1e12);
        _sell(_a, _aKey, 100e18);
        _sell(_b, _bKey, 0.3e18);
        _sell(_c, _cKey, 0.4e18);
        uint _fees = wnt.balanceOf(feeReceiver);
        uint _cash = wnt.balanceOf(body);
        vm.recordLogs();
        _redeemAt(0, 0, 1e12, _list(_account(_a)));
        (bytes memory _close,) = _execution(vm.getRecordedLogs(), body, 1);
        (,, uint _cut,, uint _unburned) = abi.decode(_close, (bytes4, uint, uint, FundStore.Redemption, uint));
        assertEq(wnt.balanceOf(_account(_a)), 99e18);
        assertEq(wnt.balanceOf(feeReceiver) - _fees, 1e18, "the fee receiver takes only A's fee");
        assertEq(_cut, 0.7e18, "the 0.7 tail is cut");
        assertEq(_cash - wnt.balanceOf(body), 100e18, "and goes back to the fund, so only A's part leaves it");
        assertEq(_unburned, 0.7e18, "the close-out records the tail's shares left unburned");
        assertEq(_queuedOf(_account(_b)), 0.3e18, "the tail keeps its claims");
        assertEq(_queuedOf(_account(_c)), 0.4e18);
        assertEq(shareToken.balanceOf(_account(_b)), 200e18, "and its shares");
        assertEq(fundStore.getRedemption(body).queued, 0.7e18);
        _assertClosed();

        _sell(_a, _aKey, 50e18);
        _fees = wnt.balanceOf(feeReceiver);
        _cash = wnt.balanceOf(body);
        _redeemAt(0, 0, 1e12, _list3(_account(_a), _account(_b), _account(_c)));
        assertEq(wnt.balanceOf(_account(_a)), 148e18);
        assertEq(wnt.balanceOf(_account(_b)), 0, "the cohort stops once the pot is dust");
        assertEq(wnt.balanceOf(feeReceiver) - _fees, 1e18, "the fee receiver again takes only A's fee");
        assertEq(_cash - wnt.balanceOf(body), 50e18, "and the tail's part stays in the fund");
        assertEq(_queuedOf(_account(_b)), 0.3e18);
        _assertClosed();
    }

    function test_an_open_moving_less_than_one_fee_on_the_hub_is_refused() public {
        _open();
        Redeem.RedeemIntent memory _i = _intentAt(0, 0.5e18, 1e12);
        bytes memory _sig = _redeemSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Redeem__Dust.selector, 0.5e18, 1e18));
        hub.redeem(_i, _sig, new address[](0));

        (address _a, uint _aKey) = _back("df-a", 401e6, 1e12);
        _sell(_a, _aKey, 0.5e18);
        address[] memory _first = _list(_account(_a));
        _i = _intentAt(0, 0, 1e12);
        _sig = _redeemSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Redeem__Dust.selector, 0.5e18, 1e18));
        hub.redeem(_i, _sig, _first);
    }

    function test_a_partial_master_exit_is_refused_while_the_queue_pot_is_at_most_one_fee() public {
        _open();
        (address _a, uint _aKey) = _back("jd-a", 401e6, 1e12);
        address[] memory _queue = _list(_account(_a));
        _sell(_a, _aKey, 0.5e18);
        Redeem.RedeemIntent memory _i = _intentAt(0, 0.6e18, 1e12);
        bytes memory _sig = _redeemSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Redeem__Dust.selector, 0.5e18, 1e18));
        hub.redeem(_i, _sig, _queue);

        _sell(_a, _aKey, 1.5e18);
        _i = _intentAt(0, 2e18, 1e12);
        hub.redeem(_i, _redeemSig(_i), _queue);
        assertEq(_queuedOf(_queue[0]), 0, "once the queue is worth more than one fee, the master exits beside it");
        _assertClosed();
    }

    function test_the_masters_fee_parts_join_its_own_part_at_the_close_and_the_store_ends_empty() public {
        _open();
        (address _u0,) = _back("mp-0", 401e6, 0.8e12);
        (address _u1,) = _back("mp-1", 301e6, 1e12);
        (address _u2,) = _back("mp-2", 201e6, 1.6e12);
        address[] memory _accts = _list3(_account(_u0), _account(_u1), _account(_u2));
        uint _base = shareToken.totalSupply() + VIRTUAL_SHARES;
        uint _nav = Math.mulDiv(1_337_123_456_789, _base, PRICE_PRECISION);
        uint[] memory _claim = new uint[](3);
        uint _owedLeft;
        for (uint _j; _j < 3; ++_j) {
            _claim[_j] = shareToken.balanceOf(_accts[_j]) * 3333;
            _owedLeft += _claim[_j];
        }
        uint _potLeft = Math.mulDiv(_owedLeft, _nav, _base * 10_000);
        uint _masterPay = Math.mulDiv(Math.mulDiv(499e18, 3333, 10_000), _nav, _base);
        uint _fees = wnt.balanceOf(feeReceiver);
        uint _protocol;

        _redeemAt(3333, 0, 1_337_123_456_789, _list(_accts[0]));
        uint _price = fundStore.getRedemption(body).price;
        assertEq(_price, Math.mulDiv(_nav, PRICE_PRECISION, _base), "the open stores its value per share");
        uint[3] memory _order = [uint(0), 2, 1];
        for (uint _k; _k < 3; ++_k) {
            if (_k == 1) {
                FundStore.Redemption memory _r = fundStore.getRedemption(body);
                assertEq(wnt.balanceOf(_ownerAccount()), 0, "the master waits while others are owed");
                assertEq(_r.potLeft, _potLeft, "the pot left is the pot less the first cohort's payout");
                assertEq(_r.masterPay, _masterPay, "the master's pay holds its own part and the fee part so far");
                assertEq(
                    wnt.balanceOf(address(fundStore)), _potLeft + _masterPay, "the store holds exactly the pot left and the master's pay"
                );
                _assertBooked();
                hub.redeemCohort(shareToken, _list(_accts[2], _accts[1]));
            }
            uint _j = _order[_k];
            uint _payout = Math.mulDiv(_potLeft, _claim[_j], _owedLeft);
            uint _cost = fundStore.getHolding(body, _accts[_j]).cost;
            uint _fee = _cost < _price ? Math.mulDiv(_payout, PERFORMANCE_FEE * (_price - _cost), _price * 10_000) : 0;
            if (_j == 2) assertEq(_fee, 0, "the holder who joined at 1.6 is at a loss and pays no fee");
            else assertGt(_fee, 0, "a holder who joined below the price pays the fee on its own gain");
            assertEq(
                wnt.balanceOf(_accts[_j]), _payout - _fee - FEE * USD, "each holder is paid its share of the pot less its own fee and one fee"
            );
            _potLeft -= _payout;
            _owedLeft -= _claim[_j];
            _masterPay += _fee - Math.mulDiv(_fee, PROTOCOL_FEE_SHARE, 10_000);
            _protocol += Math.mulDiv(_fee, PROTOCOL_FEE_SHARE, 10_000);
        }
        assertEq(_potLeft, 0);
        assertEq(wnt.balanceOf(_ownerAccount()), _masterPay - FEE * USD, "the close pays the master its own part with every fee part, less one fee");
        assertEq(wnt.balanceOf(feeReceiver) - _fees, 4 * FEE * USD, "the fee receiver takes each holder's fee slice and the master's");
        assertEq(wnt.balanceOf(protocolReceiver), _protocol, "and the protocol receiver every cut");
        _assertClosed();
    }

    function test_a_full_hub_exit_pays_all_hub_cash_and_burns_every_share() public {
        _open();
        (address _a,) = _back("fh-a", 401e6, 1e12);
        (address _b,) = _back("fh-b", 201e6, 1e12);
        _sellUsdcAway();
        uint _cash = wnt.balanceOf(body);

        Fund.Valuation memory _v = _valuation(0);
        _v.assetList[0].value = _cash + 1;
        Redeem.RedeemIntent memory _i = _redeemIntent(10_000, 0, _v);
        bytes memory _sig = _redeemSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientFund.selector, address(wnt), _cash, _cash + 1));
        hub.redeem(_i, _sig, new address[](0));

        uint _fees = wnt.balanceOf(feeReceiver);
        _v.assetList[0].value = _cash - 100e18;
        _i = _redeemIntent(10_000, 0, _v);
        hub.redeem(_i, _redeemSig(_i), _list(_account(_a)));
        uint _price = Math.mulDiv(_cash, PRICE_PRECISION, 1099e18);
        assertEq(
            fundStore.getRedemption(body).price,
            _price,
            "a full exit prices a share at the hub cash it pays over the supply, never at a lower signed valuation"
        );
        uint _pot = Math.mulDiv(600e18, _cash, 1099e18);
        uint _aPaid = Math.mulDiv(_pot, 2, 3);
        uint _aFee = Math.mulDiv(_aPaid, PERFORMANCE_FEE * (_price - 1e12), _price * 10_000);
        uint _aCut = _aFee * PROTOCOL_FEE_SHARE / 10_000;
        assertEq(wnt.balanceOf(_account(_a)), _aPaid - _aFee - 1e18, "A is paid 400/1099 of the hub cash, less a tenth of its gain and one fee");
        assertEq(
            fundStore.getRedemption(body).masterPay,
            _cash - _pot + _aFee - _aCut,
            "the master is owed all hub cash beyond the pot, beside its part of A's fee"
        );
        assertEq(
            wnt.balanceOf(address(fundStore)),
            _pot - _aPaid + _cash - _pot + _aFee - _aCut,
            "the store holds exactly the pot left and the master's pay"
        );
        _assertBooked();

        hub.redeemCohort(shareToken, _list(_account(_b)));
        uint _bFee = Math.mulDiv(_pot - _aPaid, PERFORMANCE_FEE * (_price - 1e12), _price * 10_000);
        uint _bCut = _bFee * PROTOCOL_FEE_SHARE / 10_000;
        assertEq(wnt.balanceOf(_account(_b)), _pot - _aPaid - _bFee - 1e18, "B the rest of the others' pot, less its own fee and one fee");
        assertEq(
            wnt.balanceOf(_ownerAccount()), _cash - _pot + _aFee - _aCut + _bFee - _bCut - 1e18, "the master everything else with both fee parts, last"
        );
        assertEq(wnt.balanceOf(feeReceiver) - _fees, 3e18, "the fee receiver takes the three fee slices");
        assertEq(wnt.balanceOf(protocolReceiver), _aCut + _bCut, "and the protocol receiver both cuts");
        assertEq(shareToken.totalSupply(), 0, "every share burned");
        assertEq(wnt.balanceOf(body), 0, "and the hub cash paid out in full");
        _assertClosed();
    }

    function test_value_on_a_spoke_blocks_a_full_exit_and_still_prices_a_partial_one_paid_from_hub_cash() public {
        _open();
        (address _a,) = _back("fs-a", 401e6, 1e12);
        (address _b,) = _back("fs-b", 201e6, 1e12);
        _sellUsdcAway();
        uint _cash = wnt.balanceOf(body);

        Fund.Valuation memory _v = _valuation(0);
        _v.assetList[0].value = _cash;
        _v.positionList[0].value = 2000e18;
        Redeem.RedeemIntent memory _i = _redeemIntent(10_000, 0, _v);
        bytes memory _sig = _redeemSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientFund.selector, address(wnt), _cash, _cash + 2000e18));
        hub.redeem(_i, _sig, new address[](0));

        uint _fees = wnt.balanceOf(feeReceiver);
        _i = _redeemIntent(5000, 0, _v);
        hub.redeem(_i, _redeemSig(_i), _list(_account(_a), _account(_b)));
        uint _base = 1099e18 + VIRTUAL_SHARES;
        uint _nav = _cash + 2000e18 + VIRTUAL_VALUE;
        uint _price = Math.mulDiv(_nav, PRICE_PRECISION, _base);
        assertEq(fundStore.getRedemption(body).price, _price, "a partial exit prices a share at the whole valuation, the spoke position included");
        uint _pot = Math.mulDiv(300e18, _nav, _base);
        uint _masterPart = Math.mulDiv(249.5e18, _nav, _base);
        uint _aPaid = Math.mulDiv(_pot, 2, 3);
        uint _aFee = Math.mulDiv(_aPaid, PERFORMANCE_FEE * (_price - 1e12), _price * 10_000);
        uint _bFee = Math.mulDiv(_pot - _aPaid, PERFORMANCE_FEE * (_price - 1e12), _price * 10_000);
        uint _cuts = _aFee * PROTOCOL_FEE_SHARE / 10_000 + _bFee * PROTOCOL_FEE_SHARE / 10_000;
        assertEq(wnt.balanceOf(_account(_a)), _aPaid - _aFee - 1e18, "the backers are paid at the valuation, less their own fee");
        assertEq(wnt.balanceOf(_account(_b)), _pot - _aPaid - _bFee - 1e18);
        assertEq(
            wnt.balanceOf(_ownerAccount()),
            _masterPart + _aFee + _bFee - _cuts - 1e18,
            "the master's half is paid on the hub at the same price with the fee parts"
        );
        assertEq(wnt.balanceOf(feeReceiver) - _fees, 3e18, "the fee receiver takes the three fee slices");
        assertEq(wnt.balanceOf(protocolReceiver), _cuts, "and the protocol receiver both cuts");
        assertEq(wnt.balanceOf(body), _cash - _pot - _masterPart, "all of it out of the hub cash");
        _assertClosed();
    }

    function test_a_holder_who_joined_at_the_low_pays_the_fee_on_its_own_doubling_and_one_who_rode_the_dip_pays_none() public {
        _open();
        (address _a, uint _aKey) = _back("low-a", 401e6, 1e12);
        (address _b, uint _bKey) = _back("low-b", 201e6, 0.5e12);
        address _aAcct = _account(_a);
        address _bAcct = _account(_b);
        uint _aCost = fundStore.getHolding(body, _aAcct).cost;
        uint _bCost = fundStore.getHolding(body, _bAcct).cost;
        assertEq(_aCost, 1e12, "A joined at 1.00 a share");
        assertEq(_bCost, 0.5e12, "B joined after the fund halved");
        assertEq(shareToken.balanceOf(_bAcct), 400e18, "so half the stake bought B as many shares as A");
        _sell(_a, _aKey, 400e18);
        _sell(_b, _bKey, 400e18);

        uint _fees = wnt.balanceOf(feeReceiver);
        uint _supply = shareToken.totalSupply();
        _redeemAt(0, 0, 1e12, _list(_aAcct, _bAcct));
        uint _price = fundStore.getRedemption(body).price;
        assertEq(_price, 1e12, "the fund recovered to 1.00");
        uint _payout = Math.mulDiv(400e18, _price, PRICE_PRECISION);
        assertGe(_aCost, _price, "A is back where it joined");
        assertEq(wnt.balanceOf(_aAcct), _payout - FEE * USD, "so A pays no fee, only the fee slice");
        uint _bFee = Math.mulDiv(_payout, PERFORMANCE_FEE * (_price - _bCost), _price * 10_000);
        assertEq(_bFee, 20e18, "a tenth of B's own 200 gain, 400 shares from 0.50 to 1.00");
        assertEq(wnt.balanceOf(_bAcct), _payout - _bFee - FEE * USD, "B pays the fee on its own doubling");
        assertEq(wnt.balanceOf(_bAcct), 379e18);
        uint _bCut = _bFee * PROTOCOL_FEE_SHARE / 10_000;
        assertEq(wnt.balanceOf(_ownerAccount()), _bFee - _bCut - FEE * USD, "the master's part of B's fee reaches the owner's account at the close");
        assertEq(wnt.balanceOf(feeReceiver) - _fees, 3 * FEE * USD, "the fee receiver takes the three fee slices");
        assertEq(wnt.balanceOf(protocolReceiver), _bCut, "and the protocol cut reaches the protocol receiver");
        assertEq(shareToken.totalSupply(), _supply - 800e18, "the exit only burns: no share is minted to pay a fee");
        _assertClosed();
    }

    function test_a_holder_at_a_gain_pays_the_fee_on_its_own_gain_and_one_who_joined_at_the_top_pays_none_at_a_loss() public {
        _open();
        (address _a, uint _aKey) = _back("top-a", 401e6, 1e12);
        (address _b, uint _bKey) = _back("top-b", 401e6, 2e12);
        address _aAcct = _account(_a);
        address _bAcct = _account(_b);
        uint _aCost = fundStore.getHolding(body, _aAcct).cost;
        uint _bCost = fundStore.getHolding(body, _bAcct).cost;
        assertEq(_aCost, 1e12, "A joined at 1.00 a share");
        assertEq(_bCost, 2e12, "B joined after the fund doubled");
        assertEq(shareToken.balanceOf(_bAcct), 200e18, "so the same stake bought B half the shares");
        _sell(_a, _aKey, 400e18);
        _sell(_b, _bKey, 200e18);

        uint _fees = wnt.balanceOf(feeReceiver);
        uint _supply = shareToken.totalSupply();
        _redeemAt(0, 249.5e18, 1.5e12, _list(_aAcct, _bAcct));
        uint _price = fundStore.getRedemption(body).price;
        assertEq(_price, 1.5e12, "the fund fell a quarter from 2.00");
        uint _aPayout = Math.mulDiv(400e18, _price, PRICE_PRECISION);
        uint _aFee = Math.mulDiv(_aPayout, PERFORMANCE_FEE * (_price - _aCost), _price * 10_000);
        assertEq(_aFee, 20e18, "a tenth of A's own 200 gain, 400 shares from 1.00 to 1.50");
        assertEq(wnt.balanceOf(_aAcct), _aPayout - _aFee - FEE * USD, "A pays the fee on its own gain");
        assertEq(wnt.balanceOf(_aAcct), 579e18);
        assertLt(_price, _bCost, "B is at a loss");
        assertEq(wnt.balanceOf(_bAcct), Math.mulDiv(200e18, _price, PRICE_PRECISION) - FEE * USD, "so B pays no fee, only the fee slice");
        assertEq(wnt.balanceOf(_bAcct), 299e18);
        uint _aCut = _aFee * PROTOCOL_FEE_SHARE / 10_000;
        assertEq(
            wnt.balanceOf(_ownerAccount()),
            Math.mulDiv(249.5e18, _price, PRICE_PRECISION) + _aFee - _aCut - FEE * USD,
            "the master's own half at 1.50 pays no fee and reaches the wallet with its part of A's fee"
        );
        assertEq(wnt.balanceOf(feeReceiver) - _fees, 3 * FEE * USD, "the fee receiver takes the three fee slices");
        assertEq(wnt.balanceOf(protocolReceiver), _aCut, "and the protocol cut reaches the protocol receiver");
        assertEq(shareToken.totalSupply(), _supply - 600e18 - 249.5e18, "the exit only burns");
        _assertClosed();
    }

    function test_both_modes_charge_each_holder_on_its_own_gain_and_never_one_at_cost_at_a_loss_or_the_master() public {
        _open();
        (address _g, uint _gKey) = _back("mode-gain", 201e6, 0.5e12);
        (address _c, uint _cKey) = _back("mode-cost", 401e6, 1.25e12);
        (address _l, uint _lKey) = _back("mode-loss", 401e6, 2e12);
        address[] memory _accts = _list3(_account(_g), _account(_c), _account(_l));
        assertEq(fundStore.getHolding(body, _accts[1]).cost, 1.25e12, "C paid exactly the price both exits are charged at");

        uint _fees = wnt.balanceOf(feeReceiver);
        _redeemAt(2000, 0, 1.25e12, _accts);
        assertEq(fundStore.getRedemption(body).price, 1.25e12);
        assertEq(wnt.balanceOf(_accts[0]), 93e18, "everyone mode: G's fifth, 80 at 1.25, pays a tenth of its 60 gain and one fee");
        assertEq(wnt.balanceOf(_accts[1]), 79e18, "C at cost pays only the fee slice");
        assertEq(wnt.balanceOf(_accts[2]), 49e18, "L at a loss pays only the fee slice");
        assertEq(
            wnt.balanceOf(_ownerAccount()), 129.15e18, "the master's fifth, 99.8 at 1.25, pays no fee on its own gain and takes 5.4 of G's 6"
        );
        assertEq(wnt.balanceOf(feeReceiver) - _fees, 4e18, "the fee receiver takes the four fee slices");
        assertEq(wnt.balanceOf(protocolReceiver), 0.6e18, "and the protocol receiver G's 0.6 cut");
        _assertClosed();

        _sell(_g, _gKey, 160e18);
        _sell(_c, _cKey, 128e18);
        _sell(_l, _lKey, 80e18);
        _fees = wnt.balanceOf(feeReceiver);
        _redeemAt(0, 199.6e18, 1.25e12, _accts);
        assertEq(wnt.balanceOf(_accts[0]) - 93e18, 187e18, "queue mode: G's 160 at 1.25 pays a tenth of its 120 gain and one fee");
        assertEq(wnt.balanceOf(_accts[1]) - 79e18, 159e18, "C at cost again pays only the fee slice");
        assertEq(wnt.balanceOf(_accts[2]) - 49e18, 99e18, "and L at a loss");
        assertEq(
            wnt.balanceOf(_ownerAccount()) - 129.15e18, 259.3e18, "the master's 199.6 joined at 1.25 pays no fee and takes 10.8 of G's 12"
        );
        assertEq(wnt.balanceOf(feeReceiver) - _fees, 4e18, "the fee receiver again takes the four fee slices");
        assertEq(wnt.balanceOf(protocolReceiver) - 0.6e18, 1.2e18, "and the protocol receiver G's 1.2 cut");
        assertEq(shareToken.balanceOf(body), 199.6e18);
        _assertClosed();
    }

    function test_a_sell_that_settles_an_open_redemption_charges_the_cohort_fee_and_pays_the_protocol_cut_at_once() public {
        _open();
        (address _a,) = _back("sf-a", 201e6, 0.5e12);
        (address _b, uint _bKey) = _back("sf-b", 201e6, 0.5e12);
        address _aAcct = _account(_a);
        address _bAcct = _account(_b);
        uint _fees = wnt.balanceOf(feeReceiver);
        vm.recordLogs();
        _redeemAt(2500, 0, 1e12, _list(_aAcct));
        (bytes memory _cohortRecord,) = _execution(vm.getRecordedLogs(), _aAcct, 0);
        (,,,,, uint _cohortFee, uint _cohortCut,) =
            abi.decode(_cohortRecord, (bytes4, address, uint, uint, uint, uint, uint, FundStore.Redemption));
        FundStore.Redemption memory _r = fundStore.getRedemption(body);
        assertEq(_cohortFee, 5e18, "A's quarter, 100 at 1.00, pays a tenth of its 50 gain in the open's cohort");
        assertEq(wnt.balanceOf(_aAcct), 100e18 - _cohortFee - FEE * USD);
        assertEq(_r.masterPay, 124.75e18 + _cohortFee - _cohortCut, "the master's pay holds its own quarter and its part of A's fee");
        assertEq(wnt.balanceOf(address(fundStore)), _r.potLeft + _r.masterPay, "the store holds exactly the pot left and the master's pay");
        _assertBooked();

        uint _feeUsdc = usdc.balanceOf(feeReceiver);
        uint _feeWeth = wnt.balanceOf(feeReceiver);
        uint _cuts = wnt.balanceOf(protocolReceiver);
        vm.recordLogs();
        _sell(_b, _bKey, 50e18);
        (bytes memory _sale,) = _execution(vm.getRecordedLogs(), _bAcct, 0);
        (,,,,,,, uint _payout, uint _saleFee, uint _saleCut,,) = abi.decode(
            _sale, (bytes4, address, uint, FundStore.Holding, FundStore.Redemption, uint, uint, uint, uint, uint, address, uint)
        );
        FundStore.Redemption memory _after = fundStore.getRedemption(body);
        assertEq(_payout, 100e18, "the sell settles B's same quarter first");
        assertEq(_saleFee, _cohortFee, "at the same fee a cohort charges");
        assertEq(_saleCut, _cohortCut);
        assertEq(wnt.balanceOf(_bAcct), _payout - _saleFee, "paying B its payout less that fee, with no cohort fee slice");
        assertEq(wnt.balanceOf(protocolReceiver) - _cuts, _saleCut, "the protocol cut is paid at once to the protocol receiver");
        assertEq(wnt.balanceOf(feeReceiver), _feeWeth, "while the fee receiver takes no WETH");
        assertEq(usdc.balanceOf(feeReceiver) - _feeUsdc, FEE, "beside the sell's own relay fee");
        assertEq(_after.masterPay, _r.masterPay + _saleFee - _saleCut, "and the master's part joins its pay");
        assertEq(_after.potLeft, _r.potLeft - _payout);
        assertEq(_after.owedLeft, 0);
        assertTrue(isOpen(_after), "which keeps the redemption open");
        assertEq(wnt.balanceOf(address(fundStore)), _after.masterPay, "the store holds exactly the master's pay");
        _assertBooked();
        assertEq(_queuedOf(_bAcct), 50e18, "B's new sale waits for the next redemption");

        hub.redeemCohort(shareToken, new address[](0));
        assertEq(wnt.balanceOf(_ownerAccount()), 132.75e18, "an empty cohort pays the master its quarter and both fee parts, less one fee");
        assertEq(wnt.balanceOf(feeReceiver) - _fees, 2e18, "the fee receiver took the two fee slices");
        assertEq(wnt.balanceOf(protocolReceiver), 1e18, "and the protocol receiver both 0.5 cuts");
        _assertClosed();
    }

    function test_shares_never_move_and_only_the_redemption_budget_or_the_master_itself_burns() public {
        _open();
        (address _a, uint _aKey) = _back("tok-a", 401e6, 1e12);
        address _aAcct = _account(_a);

        vm.prank(_aAcct);
        vm.expectRevert(Error.ShareToken__Forbidden.selector);
        shareToken.transfer(address(shareToken), 1);
        vm.prank(_aAcct);
        vm.expectRevert(Error.ShareToken__Forbidden.selector);
        shareToken.transfer(makeAddr("elsewhere"), 1);

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(Error.ShareToken__Forbidden.selector);
        shareToken.burn(_aAcct, 1);
        vm.prank(body);
        vm.expectRevert(Error.ShareToken__Forbidden.selector);
        shareToken.burn(_aAcct, 1);
        vm.prank(address(redeemModule));
        vm.expectRevert(Error.ShareToken__Forbidden.selector);
        shareToken.burn(_aAcct, 1);
        vm.prank(body);
        shareToken.burn(body, 1e18);
        assertEq(shareToken.balanceOf(body), 498e18, "the master burns its own shares");

        SwapLib.SwapParams memory _swap = SwapLib.SwapParams({
            inputToken: address(usdc),
            inputAmount: 20e6,
            outputToken: address(usdc),
            outputAmount: 1,
            provider: address(shareToken),
            providerCallData: abi.encodeCall(ShareToken.transfer, (address(shareToken), 100e18))
        });
        Deposit.SwapIntent memory _w =
            Deposit.SwapIntent({header: _header(_aAcct, _a, _nonceOf(_aAcct)), swap: _swap, destinationChainId: FOREIGN_CHAIN_ID});
        bytes memory _wSig = _swapSig(WITHDRAW_INTENT_TYPEHASH, _aKey, _aAcct, _w);
        vm.expectRevert(Error.ShareToken__Forbidden.selector);
        hub.withdraw(_w, _wSig);
        assertEq(fundStore.getRedemption(body).queued, 0, "no co-signed provider call can feed the queue");
        assertEq(shareToken.balanceOf(_aAcct), 400e18);
    }

    function test_only_the_redeem_proxy_burns_a_holders_shares_and_only_within_the_budget_the_master_sets() public {
        _open();
        (address _a,) = _back("bn-a", 401e6, 1e12);
        address _aAcct = _account(_a);
        assertEq(shareToken.burner(), address(redeemModule));
        assertEq(shareToken.pendingBurn(), 0, "a fund that never redeemed has no burn budget");

        vm.expectRevert(Error.ShareToken__Forbidden.selector);
        vm.prank(_aAcct);
        shareToken.allowBurn(1);
        vm.expectRevert(Error.ShareToken__Forbidden.selector);
        vm.prank(address(redeemModule));
        shareToken.allowBurn(1);

        vm.prank(body);
        shareToken.allowBurn(5e18);
        assertEq(shareToken.pendingBurn(), 5e18, "only the master sets the budget");
        vm.prank(body);
        shareToken.allowBurn(3e18);
        assertEq(shareToken.pendingBurn(), 3e18, "and a later budget replaces it rather than adding to it");
        assertEq(shareToken.burner(), address(redeemModule), "while the burner stays the Redeem proxy");

        address[4] memory _others = [_aAcct, body, address(fundModule), address(hub)];
        for (uint _k; _k < _others.length; ++_k) {
            vm.expectRevert(Error.ShareToken__Forbidden.selector);
            vm.prank(_others[_k]);
            shareToken.burn(_aAcct, 1);
        }
        vm.expectRevert(Error.ShareToken__Forbidden.selector);
        vm.prank(address(redeemModule));
        shareToken.burn(_aAcct, 3e18 + 1);

        vm.prank(address(redeemModule));
        shareToken.burn(_aAcct, 2e18);
        assertEq(shareToken.balanceOf(_aAcct), 398e18, "the Redeem proxy burns a holder's shares within the budget");
        assertEq(shareToken.pendingBurn(), 1e18, "spending that much of it");
        vm.prank(address(redeemModule));
        shareToken.burn(_aAcct, 1e18);
        assertEq(shareToken.pendingBurn(), 0, "down to nothing");
        vm.expectRevert(Error.ShareToken__Forbidden.selector);
        vm.prank(address(redeemModule));
        shareToken.burn(_aAcct, 1);

        vm.expectRevert(Error.ShareToken__Forbidden.selector);
        new ShareToken(address(0));
    }

    function test_the_cohort_cap_bounds_both_the_open_and_a_cohort() public {
        _open();
        address[] memory _many = new address[](101);
        for (uint _j; _j < 101; ++_j) {
            _many[_j] = address(uint160(0x5000 + _j));
        }
        vm.expectRevert(abi.encodeWithSelector(Error.Gate__ListTooLong.selector, 101, 100));
        hub.redeemCohort(shareToken, _many);
        Redeem.RedeemIntent memory _i = _intentAt(0, 100e18, 1e12);
        bytes memory _sig = _redeemSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Gate__ListTooLong.selector, 101, 100));
        hub.redeem(_i, _sig, _many);
    }

    function _usdcRedemption() internal returns (Redeem.RedeemIntent memory intent_) {
        vm.startPrank(body);
        wnt.transfer(makeAddr("swapped-weth"), wnt.balanceOf(body));
        vm.stopPrank();
        uint _held = usdc.balanceOf(body);
        Fund.Valuation memory _v;
        _v.assetList = new Fund.Asset[](1);
        _v.assetList[0] = Fund.Asset({chainId: block.chainid, token: address(usdc), id: 0, amount: _held, value: _held * 1e12});
        _v.positionList = new Fund.Position[](0);
        intent_ = _redeemIntent(2500, 0, _v);
        intent_.token = address(usdc);
        intent_.header.feeToken = address(usdc);
        intent_.header.fee = FEE;
    }

    function test_a_holder_whose_payout_the_token_refuses_keeps_its_shares_and_queue_while_the_rest_are_paid_and_the_redemption_closes()
        public
    {
        _open();
        (address _a,) = _back("refused-a", 401e6, 1e12);
        (address _b,) = _back("refused-b", 401e6, 1e12);
        address _aAcct = _account(_a);
        address _bAcct = _account(_b);
        Redeem.RedeemIntent memory _i = _usdcRedemption();
        address[] memory _holders = new address[](2);
        (_holders[0], _holders[1]) = uint160(_aAcct) < uint160(_bAcct) ? (_aAcct, _bAcct) : (_bAcct, _aAcct);
        vm.mockCallRevert(address(usdc), abi.encodeWithSelector(IERC20.transfer.selector, _aAcct), bytes("blocked"));
        uint _aShares = shareToken.balanceOf(_aAcct);
        uint _aQueued = fundStore.getHolding(body, _aAcct).queued;
        uint _aCash = usdc.balanceOf(_aAcct);
        uint _bCash = usdc.balanceOf(_bAcct);
        uint _bShares = shareToken.balanceOf(_bAcct);
        uint _ownerCash = usdc.balanceOf(_ownerAccount());
        bytes memory _sig = _redeemSig(_i);
        vm.recordLogs();
        hub.redeem(_i, _sig, _holders);
        Vm.Log[] memory _logs = vm.getRecordedLogs();

        assertEq(shareToken.balanceOf(_aAcct), _aShares, "the holder the token refuses keeps every share");
        assertEq(fundStore.getHolding(body, _aAcct).queued, _aQueued, "and its queue");
        assertEq(usdc.balanceOf(_aAcct), _aCash, "and receives nothing");
        assertGt(usdc.balanceOf(_bAcct), _bCash, "while the other holder is paid");
        assertLt(shareToken.balanceOf(_bAcct), _bShares, "and burns its part");
        assertGt(usdc.balanceOf(_ownerAccount()), _ownerCash, "the owner's close-out lands in the owner's account");
        assertFalse(isOpen(fundStore.getRedemption(body)), "and one refused payee no longer holds the fund open");
        assertEq(fundStore.bookedMap(body, address(usdc)), 0, "the refused share's cut spends its booking too");

        (bytes memory _record,) = _execution(_logs, _aAcct, 0);
        (,, uint _queued, uint _burned, uint _payout, uint _profitFee, uint _protocolCut,, bool _refused) =
            abi.decode(_record, (bytes4, address, uint, uint, uint, uint, uint, FundStore.Redemption, bool));
        assertTrue(_refused, "its record says the token refused the payout");
        assertEq(_queued + _burned + _profitFee + _protocolCut, 0, "and that it burned and paid nothing");
        assertGt(_payout, 0, "while naming the pot share that went back to the fund");
        (_record,) = _execution(_logs, _bAcct, 0);
        (,,,,,,,, _refused) = abi.decode(_record, (bytes4, address, uint, uint, uint, uint, uint, FundStore.Redemption, bool));
        assertFalse(_refused, "a paid holder's record says it was not refused");
        (bytes memory _owner,) = _execution(_logs, _ownerAccount(), 0);
        (, address _master, address _token, uint _paid) = abi.decode(_owner, (bytes4, address, address, uint));
        assertEq(_master, body, "the owner's record names its fund");
        assertEq(_token, address(usdc), "and the token it was paid in");
        assertEq(_paid, usdc.balanceOf(_ownerAccount()) - _ownerCash, "and exactly what reached the owner's account");
        (bytes memory _close,) = _execution(_logs, body, 1);
        (,, uint _cut,,) = abi.decode(_close, (bytes4, uint, uint, FundStore.Redemption, uint));
        assertGe(_cut, _payout, "the refused share returns to the fund as a cut");
    }

    function test_a_payout_the_store_cannot_cover_still_reverts_and_is_never_taken_for_a_refusal() public {
        _open();
        (address _a,) = _back("short-a", 401e6, 1e12);
        address _aAcct = _account(_a);
        Redeem.RedeemIntent memory _i = _usdcRedemption();
        hub.redeem(_i, _redeemSig(_i), new address[](0));
        assertTrue(isOpen(fundStore.getRedemption(body)), "the open leaves the backer owed");
        deal(address(usdc), address(fundStore), 0);
        vm.mockCallRevert(address(usdc), abi.encodeWithSelector(IERC20.transfer.selector, _aAcct), bytes("blocked"));
        address[] memory _holders = new address[](1);
        _holders[0] = _aAcct;
        try hub.redeemCohort(shareToken, _holders) {
            revert("a payout the store could not cover settled");
        } catch (bytes memory _reason) {
            address _receiver;
            assembly ("memory-safe") {
                _receiver := mload(add(_reason, 68))
            }
            assertEq(bytes4(_reason), Error.TransferUtils__TokenTransferError.selector, "the holder's own transfer fails");
            assertEq(_receiver, _aAcct, "and reverts the cohort as the holder's payout, never as a later cut");
        }
    }

    function test_a_cohort_without_gas_for_a_whole_transfer_reverts_rather_than_take_the_payout_for_refused() public {
        _open();
        (address _a,) = _back("gas-a", 401e6, 1e12);
        address _aAcct = _account(_a);
        Redeem.RedeemIntent memory _i = _usdcRedemption();
        hub.redeem(_i, _redeemSig(_i), new address[](0));
        address[] memory _holders = new address[](1);
        _holders[0] = _aAcct;
        vm.expectPartialRevert(Error.Redeem__OutOfGas.selector);
        hub.redeemCohort{gas: 300_000}(shareToken, _holders);
        hub.redeemCohort(shareToken, _holders);
        assertFalse(isOpen(fundStore.getRedemption(body)), "with gas for the transfer the same cohort settles and closes");
    }

    function _execution(
        Vm.Log[] memory _logs,
        address _account,
        uint _nth
    ) internal pure returns (bytes memory execution_, BalanceLib.Balance[] memory balanceList_) {
        uint _seen;
        for (uint _k; _k < _logs.length; ++_k) {
            if (_logs[_k].topics[0] != AccountModule.AccountCall.selector) continue;
            if (address(uint160(uint(_logs[_k].topics[1]))) != _account) continue;
            if (_seen++ < _nth) continue;
            (,,,,, execution_,,, balanceList_) = abi.decode(
                _logs[_k].data, (uint, uint, uint, bytes32, bytes, bytes, IAccount.Call[], bytes[], BalanceLib.Balance[])
            );
            return (execution_, balanceList_);
        }
        revert("no such record");
    }

    function _assertSame(
        FundStore.Redemption memory _got,
        FundStore.Redemption memory _want,
        string memory _what
    ) internal pure {
        assertEq(keccak256(abi.encode(_got)), keccak256(abi.encode(_want)), _what);
    }

    function test_every_redemption_record_carries_the_redemption_post_state() public {
        _open();
        (address _a, uint _aKey) = _back("rec-a", 401e6, 1e12);
        (address _b, uint _bKey) = _back("rec-b", 201e6, 1e12);
        address _aAcct = _account(_a);
        address _bAcct = _account(_b);
        _sell(_a, _aKey, 100e18);

        vm.recordLogs();
        _redeemAt(2000, 0, 1.25e12, _list(_aAcct));
        Vm.Log[] memory _logs = vm.getRecordedLogs();
        FundStore.Redemption memory _now = fundStore.getRedemption(body);

        (bytes memory _opened, BalanceLib.Balance[] memory _openBalances) = _execution(_logs, body, 0);
        (,,, uint _active, uint _masterShares,, FundStore.Redemption memory _atOpen) =
            abi.decode(_opened, (bytes4, uint, uint, uint, uint, uint, FundStore.Redemption));
        assertEq(_active, 500e18, "the open record carries what it read");
        assertEq(_masterShares, 499e18);
        assertEq(_atOpen.queued, 100e18);
        assertEq(_atOpen.owedLeft, 100e18 * 1e4 + 500e18 * 2000, "and the redemption it opened");
        assertEq(_atOpen.price, 1.25e12, "with the price every exit is charged against");
        assertEq(_atOpen.masterPay, 124.75e18, "and the master's part at that price");
        assertEq(_openBalances[2].amount, 499e18 - 99.8e18, "with the master's shares after its burn");

        (bytes memory _holder,) = _execution(_logs, _aAcct, 0);
        (, address _master, uint _queued, uint _burned, uint _payout, uint _profitFee, uint _protocolCut, FundStore.Redemption memory _afterA) =
            abi.decode(_holder, (bytes4, address, uint, uint, uint, uint, uint, FundStore.Redemption));
        assertEq(_master, body);
        assertEq(_queued, 100e18);
        assertEq(_burned, 60e18, "a fifth of A's free 300");
        assertEq(_payout, 200e18);
        assertEq(_profitFee, 4e18, "the holder record carries the fee on A's 40 gain");
        assertEq(_protocolCut, 0.4e18, "and the protocol's cut of it");
        assertEq(_afterA.masterPay, 124.75e18 + 3.6e18, "whose rest joins the master's pay");
        _assertSame(_afterA, _now, "the holder record carries the state its settlement left");

        vm.recordLogs();
        _sell(_b, _bKey, 10e18);
        _logs = vm.getRecordedLogs();
        _now = fundStore.getRedemption(body);
        (bytes memory _sale,) = _execution(_logs, _bAcct, 0);
        (,,, FundStore.Holding memory _holding, FundStore.Redemption memory _afterSale, uint _sq, uint _sb, uint _sp, uint _sf, uint _sc,,) =
            abi.decode(
                _sale, (bytes4, address, uint, FundStore.Holding, FundStore.Redemption, uint, uint, uint, uint, uint, address, uint)
            );
        assertEq(_holding.queued, 10e18, "the sell record carries the seller's holding after it");
        assertEq(_holding.redeemedAt, _now.id);
        assertEq(_holding.cost, 1e12, "with the price it paid per share");
        assertEq(_sq, 0);
        assertEq(_sb, 40e18, "the settlement it ran first");
        assertEq(_sp, 50e18);
        assertEq(_sf, 1e18, "and the fee that settlement charged");
        assertEq(_sc, 0.1e18);
        _assertSame(_afterSale, _now, "and the redemption it left");
        assertEq(_now.owedLeft, 0);
        assertEq(_now.masterPay, 129.25e18);

        vm.recordLogs();
        hub.redeemCohort(shareToken, new address[](0));
        _logs = vm.getRecordedLogs();
        (bytes memory _close,) = _execution(_logs, body, 0);
        (, uint _masterPayout, uint _cut, FundStore.Redemption memory _closed, uint _unburned) =
            abi.decode(_close, (bytes4, uint, uint, FundStore.Redemption, uint));
        assertEq(_masterPayout, 129.25e18, "the close-out record carries the master's part with every fee part");
        assertEq(wnt.balanceOf(_ownerAccount()), 128.25e18, "paid to the owner's account less one fee");
        assertEq(_cut, 0);
        assertEq(_unburned, shareToken.pendingBurn(), "the close-out record carries the burn budget left unspent");
        _assertSame(_closed, fundStore.getRedemption(body), "the close-out record carries the closed state");
        _assertClosed();
    }

    struct Fuzz {
        uint n;
        uint fraction;
        uint join;
        uint price;
        uint first;
        uint cash;
        uint supply;
        uint masterShares;
        uint queued;
        uint active;
        uint masterPart;
        uint owed;
        uint base;
        uint nav;
        uint pot;
        uint masterPay;
        uint stored;
    }

    struct Settled {
        uint potLeft;
        uint owedLeft;
        uint masterPay;
        uint fees;
        uint cuts;
        uint master;
        uint cutBack;
        uint paidOut;
        uint burned;
    }

    function testFuzz_every_claim_is_paid_its_share_of_one_pot_less_its_own_fee_and_value_is_conserved(
        uint _seed,
        uint8 _count,
        uint16 _fraction,
        uint16 _priceBps,
        uint8 _first
    ) public {
        _open();
        _wethTo(body, 90_000e18);
        Fuzz memory _f;
        _f.n = bound(_count, 1, 6);
        _f.price = bound(_priceBps, 3000, 30_000) * 1e8;
        address[] memory _holders = new address[](_f.n);
        address[] memory _users = new address[](_f.n);
        uint[] memory _keys = new uint[](_f.n);
        for (uint _j; _j < _f.n; ++_j) {
            (_users[_j], _keys[_j]) = _back(
                string.concat("fz-", vm.toString(_j)),
                bound(uint(keccak256(abi.encode(_seed, "stake", _j))), 11, 500) * 1e6,
                bound(uint(keccak256(abi.encode(_seed, "entry", _j))), 3000, 30_000) * 1e8
            );
            _holders[_j] = _account(_users[_j]);
        }
        for (uint _j; _j < _f.n; ++_j) {
            if (uint(keccak256(abi.encode(_seed, "twice", _j))) % 2 == 0) continue;
            _back(
                string.concat("fz-", vm.toString(_j)),
                bound(uint(keccak256(abi.encode(_seed, "stake-again", _j))), 11, 500) * 1e6,
                bound(uint(keccak256(abi.encode(_seed, "entry-again", _j))), 3000, 30_000) * 1e8
            );
        }
        for (uint _j; _j < _f.n; ++_j) {
            uint _sold = bound(uint(keccak256(abi.encode(_seed, "sold", _j))), 0, shareToken.balanceOf(_holders[_j]));
            if (uint(keccak256(abi.encode(_seed, "tiny", _j))) % 3 == 0) _sold %= 3e18;
            if (_j == 0 && _sold == 0) _sold = 1e18;
            if (_sold > 0) _sell(_users[_j], _keys[_j], _sold);
        }
        _f.cash = wnt.balanceOf(body);
        _f.supply = shareToken.totalSupply();
        _f.masterShares = shareToken.balanceOf(body);
        _f.queued = fundStore.getRedemption(body).queued;
        _f.active = _f.supply - _f.masterShares - _f.queued;
        _f.fraction = bound(_fraction, 0, 9999);
        if (_f.fraction == 0) {
            _f.join = bound(
                uint(keccak256(abi.encode(_seed, "join"))), 0, Math.mulDiv(_f.masterShares, _f.queued, _f.active + _f.queued)
            );
        }
        _f.masterPart = _f.fraction > 0 ? Math.mulDiv(_f.masterShares, _f.fraction, 1e4) : _f.join;

        uint[] memory _claim = new uint[](_f.n);
        uint[] memory _burn = new uint[](_f.n);
        for (uint _j; _j < _f.n; ++_j) {
            uint _q = _queuedOf(_holders[_j]);
            uint _free = shareToken.balanceOf(_holders[_j]) - _q;
            _claim[_j] = _q * 1e4 + _free * _f.fraction;
            _burn[_j] = _q + Math.mulDiv(_free, _f.fraction, 1e4);
            _f.owed += _claim[_j];
        }
        assertEq(_f.owed, _f.queued * 1e4 + _f.active * _f.fraction, "the claims sum exactly to what the open owes");

        bool _full = _f.owed + _f.masterPart * 1e4 == _f.supply * 1e4;
        _f.base = _full ? _f.supply : _f.supply + VIRTUAL_SHARES;
        _f.nav = _full ? _f.cash : Math.mulDiv(_f.price, _f.supply + VIRTUAL_SHARES, PRICE_PRECISION);
        _f.pot = Math.mulDiv(_f.owed, _f.nav, _f.base * 1e4);
        _f.masterPay = _full ? _f.cash - _f.pot : Math.mulDiv(_f.masterPart, _f.nav, _f.base);
        _f.stored = Math.mulDiv(_f.nav, PRICE_PRECISION, _f.base);

        Redeem.RedeemIntent memory _i = _intentAt(_f.fraction, _f.join, _f.price);
        bytes memory _sig = _redeemSig(_i);
        _f.first = bound(_first, 0, _f.n);
        address[] memory _head = new address[](_f.first);
        address[] memory _tail = new address[](_f.n - _f.first);
        uint[] memory _order = new uint[](_f.n);
        for (uint _j; _j < _f.n; ++_j) {
            if (_j < _f.first) {
                _head[_j] = _holders[_j];
                _order[_j] = _j;
            } else {
                _tail[_f.n - 1 - _j] = _holders[_j];
                _order[_f.first + _f.n - 1 - _j] = _j;
            }
        }
        if (_f.pot + _f.masterPay < 1e18) {
            vm.expectRevert(abi.encodeWithSelector(Error.Redeem__Dust.selector, _f.pot + _f.masterPay, 1e18));
            hub.redeem(_i, _sig, _head);
            return;
        }
        if (!_full && _f.masterPart > 0 && _f.owed > 0 && _f.pot <= 1e18) {
            vm.expectRevert(abi.encodeWithSelector(Error.Redeem__Dust.selector, _f.pot, 1e18));
            hub.redeem(_i, _sig, _head);
            return;
        }

        uint[] memory _before = new uint[](_f.n);
        uint[] memory _held = new uint[](_f.n);
        for (uint _j; _j < _f.n; ++_j) {
            _before[_j] = wnt.balanceOf(_holders[_j]);
            _held[_j] = shareToken.balanceOf(_holders[_j]);
        }
        uint _fees = wnt.balanceOf(feeReceiver);
        uint _cuts = wnt.balanceOf(protocolReceiver);
        uint _wallet = wnt.balanceOf(_ownerAccount());
        hub.redeem(_i, _sig, _head);
        assertEq(fundStore.getRedemption(body).price, _f.stored, "the open stores its value per share");
        bool[] memory _bySell = new bool[](_f.n);
        for (uint _m = _f.first; _m < _f.n; ++_m) {
            uint _j = _order[_m];
            if (uint(keccak256(abi.encode(_seed, "sell-out", _j))) % 3 != 0) continue;
            if (shareToken.balanceOf(_holders[_j]) == _queuedOf(_holders[_j])) continue;
            _bySell[_j] = true;
            _sell(_users[_j], _keys[_j], 1);
        }
        hub.redeemCohort(shareToken, _tail);
        _assertClosed();

        Settled memory _s = Settled({
            potLeft: _f.pot, owedLeft: _f.owed, masterPay: _f.masterPay, fees: 0, cuts: 0, master: 0, cutBack: 0, paidOut: 0, burned: 0
        });
        uint[] memory _expected = new uint[](_f.n);
        bool[] memory _settled = new bool[](_f.n);
        bool[] memory _kept = new bool[](_f.n);
        uint _owedAtCall = _f.owed;
        for (uint _k; _k <= _f.n; ++_k) {
            if (_k == _f.first || _k == _f.n) {
                if (_s.owedLeft > 0 && _s.potLeft <= 1e18) {
                    _s.cutBack += _s.potLeft;
                    _s.owedLeft = 0;
                    _s.potLeft = 0;
                }
                if (_s.owedLeft == 0 && (_owedAtCall > 0 || _s.masterPay > 0)) {
                    _s.fees += Math.min(_s.masterPay, 1e18);
                    _s.master += _s.masterPay - Math.min(_s.masterPay, 1e18);
                    _s.masterPay = 0;
                }
            }
            if (_k == _f.first) {
                for (uint _m = _f.first; _m < _f.n; ++_m) {
                    uint _sold = _order[_m];
                    if (!_bySell[_sold] || _s.owedLeft == 0) continue;
                    uint _payout = Math.mulDiv(_s.potLeft, _claim[_sold], _s.owedLeft);
                    uint _cost = fundStore.getHolding(body, _holders[_sold]).cost;
                    uint _fee =
                        _cost < _f.stored ? Math.mulDiv(_payout, PERFORMANCE_FEE * (_f.stored - _cost), _f.stored * 10_000) : 0;
                    _s.potLeft -= _payout;
                    _s.owedLeft -= _claim[_sold];
                    _s.masterPay += _fee - Math.mulDiv(_fee, PROTOCOL_FEE_SHARE, 10_000);
                    _s.cuts += Math.mulDiv(_fee, PROTOCOL_FEE_SHARE, 10_000);
                    _expected[_sold] = _payout - _fee;
                    _settled[_sold] = true;
                }
                _owedAtCall = _s.owedLeft;
            }
            if (_k == _f.n || _s.potLeft <= 1e18) continue;
            uint _j = _order[_k];
            if (_settled[_j] || _claim[_j] == 0) continue;
            uint _payout = Math.mulDiv(_s.potLeft, _claim[_j], _s.owedLeft);
            uint _cost = fundStore.getHolding(body, _holders[_j]).cost;
            uint _fee = _cost < _f.stored ? Math.mulDiv(_payout, PERFORMANCE_FEE * (_f.stored - _cost), _f.stored * 10_000) : 0;
            _s.potLeft -= _payout;
            _s.owedLeft -= _claim[_j];
            if (_payout - _fee > 1e18) {
                _s.masterPay += _fee - Math.mulDiv(_fee, PROTOCOL_FEE_SHARE, 10_000);
                _s.cuts += Math.mulDiv(_fee, PROTOCOL_FEE_SHARE, 10_000);
                _s.fees += 1e18;
                _expected[_j] = _payout - _fee - 1e18;
            } else {
                _s.cutBack += _payout;
                _kept[_j] = true;
            }
            _settled[_j] = true;
        }

        for (uint _j; _j < _f.n; ++_j) {
            uint _got = wnt.balanceOf(_holders[_j]) - _before[_j];
            assertEq(_got, _expected[_j], "every holder is paid its share of the one pot, less its own fee and one fee");
            assertEq(
                _held[_j] - shareToken.balanceOf(_holders[_j]),
                _settled[_j] && !_kept[_j] ? _burn[_j] : 0,
                "and burns its queue and its fraction once paid, while every cut claim keeps its shares"
            );
            _s.paidOut += _got;
            if (_settled[_j] && !_kept[_j]) _s.burned += _burn[_j];
        }
        assertEq(wnt.balanceOf(feeReceiver) - _fees, _s.fees, "the fee receiver takes one fee slice per paid claim and the master's");
        assertEq(wnt.balanceOf(protocolReceiver) - _cuts, _s.cuts, "the protocol receiver takes every cut");
        assertEq(wnt.balanceOf(_ownerAccount()) - _wallet, _s.master, "the owner's account takes the master's part and every fee part, less one fee");
        assertEq(wnt.balanceOf(body), _f.cash - _f.pot - _f.masterPay + _s.cutBack, "only cut claims come back to the fund");
        assertEq(shareToken.totalSupply(), _f.supply - _f.masterPart - _s.burned, "shares burn exactly as paid");
        assertEq(
            _s.paidOut + (wnt.balanceOf(feeReceiver) - _fees) + (wnt.balanceOf(protocolReceiver) - _cuts)
                + (wnt.balanceOf(_ownerAccount()) - _wallet) + _s.cutBack,
            _f.pot + _f.masterPay,
            "every wei of the pot and the master's part reaches a holder, the owner, the fee receiver or the protocol receiver, or comes back as a cut"
        );
    }

    function test_fulfil_binds_a_fresh_fund_and_pays_only_its_owners_own_within_that_escrow() public {
        _open();
        address _owner = _account(master);
        _depositEscrow(address(usdc), 100e6);
        (address _fresh, uint _freshKey) = makeAddrAndKey("fresh-body");
        address _other = _account(backer);
        AccountLib.Genesis memory _wrong = AccountLib.Genesis({
            parent: _other,
            key: _coSig(_freshKey, AccountLib.genesisDigest(address(accountModule), _fresh, _other)),
            approval: _fundApproval(backerKey, _fresh)
        });
        AccountLib.Genesis memory _right = AccountLib.Genesis({
            parent: _owner,
            key: _coSig(_freshKey, AccountLib.genesisDigest(address(accountModule), _fresh, _owner)),
            approval: _fundApproval(masterKey, _fresh)
        });
        bytes memory _ownerSig =
            _coSig(masterKey, AccountLib.creditDigest(_owner, _fresh, FOREIGN_CHAIN_ID, address(usdc), 50e6, FEE));
        bytes memory _otherSig =
            _coSig(backerKey, AccountLib.creditDigest(_other, _fresh, FOREIGN_CHAIN_ID, address(usdc), 50e6, FEE));
        address _bodyImpl = accountModule.bodyImpl();

        vm.chainId(FOREIGN_CHAIN_ID);
        vm.signAndAttachDelegation(_bodyImpl, _freshKey);
        vm.expectRevert(Error.Account__InvalidSignature.selector);
        spoke.fulfil(_fresh, address(usdc), 50e6, FEE, _ownerSig, _wrong);
        vm.signAndAttachDelegation(_bodyImpl, _freshKey);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 0, 50e6));
        spoke.fulfil(_fresh, address(usdc), 50e6, FEE, _otherSig, _wrong);
        vm.signAndAttachDelegation(_bodyImpl, _freshKey);
        spoke.fulfil(_fresh, address(usdc), 50e6, FEE, _ownerSig, _right);
        vm.chainId(HUB_CHAIN);
        (, address _bound) = FundAccount(payable(_fresh)).bound();
        assertEq(_bound, _owner, "the first fulfil binds the fresh fund to the owner whose signed total it carries");
        assertEq(usdc.balanceOf(_fresh), 50e6 - FEE, "and releases that owner's escrow to it net of the fee");
        assertEq(spokeEscrowStore.fulfilledMap(_owner, _fresh, address(usdc)), 50e6, "the per-fund total tracks its credit");

        bytes memory _over = _creditSignature(FOREIGN_CHAIN_ID, address(usdc), 60e6, FEE);
        vm.chainId(FOREIGN_CHAIN_ID);
        vm.expectRevert(abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 50e6, 60e6));
        spoke.fulfil(body, address(usdc), 60e6, FEE, _over, _noGenesis());
        vm.chainId(HUB_CHAIN);
        _fulfil(address(usdc), 50e6, FEE);
        assertEq(spokeEscrowStore.fulfilledMap(_owner, body, address(usdc)), 50e6, "each fund keeps its own total");
        assertEq(spokeEscrowStore.releasedMap(_owner, address(usdc)), 100e6, "and the owner total never passes the escrow");
    }

    function _settleOwnerTotal(
        LiquidityGate _gate,
        uint _increment,
        bytes memory _revert
    ) internal {
        if (address(_gate) == address(spoke)) {
            address _owner = _account(master);
            uint _total = spokeEscrowStore.fulfilledMap(_owner, body, address(usdc)) + _increment;
            uint _feeTotal = spokeEscrowStore.feePaidMap(_owner, body, address(usdc)) + FEE;
            bytes memory _signature = _creditSignature(FOREIGN_CHAIN_ID, address(usdc), _total, _feeTotal);
            vm.chainId(FOREIGN_CHAIN_ID);
            if (_revert.length > 0) vm.expectRevert(_revert);
            spoke.fulfil(body, address(usdc), _total, _feeTotal, _signature, _noGenesis());
            vm.chainId(HUB_CHAIN);
            return;
        }
        (Fund.AllocateIntent memory _i,) = _allocateIntent(
            _nonceOf(body), _nav(), _credit(block.chainid, address(usdc), _increment), new Fund.Allocation[](0)
        );
        _i.header.deadline = vm.getBlockTimestamp() + 300;
        bytes memory _sig = _pair(masterKey, _allocateDigest(_i));
        bytes memory _ownerSig = _ownerCoSig(_i);
        if (_revert.length > 0) vm.expectRevert(_revert);
        hub.allocate(_i, _sig, _ownerSig);
    }

    function _returnsOnlyTheOpenRestADayAfterTheRequest(
        LiquidityGate _gate,
        EscrowStore _store
    ) internal {
        address _owner = _account(master);
        uint _wallet = usdc.balanceOf(master);
        uint _escrowed = _store.escrowedMap(_owner, address(usdc));
        assertEq(
            _escrowed - _store.releasedMap(_owner, address(usdc)) - _store.returnedMap(_owner, address(usdc)),
            40e6,
            "the owner has 40 of its escrow open"
        );
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__ReturnNotReady.selector, 0));
        vm.prank(master);
        _gate.returnEscrow(address(usdc));

        uint _requestedAt = vm.getBlockTimestamp();
        vm.recordLogs();
        vm.prank(master);
        _gate.requestReturn(address(usdc));
        (bytes memory _record,) = _execution(vm.getRecordedLogs(), _owner, 0);
        (,, uint _returnAt) = abi.decode(_record, (bytes4, address, uint));
        assertEq(_returnAt, _requestedAt + ESCROW_RETURN_DELAY, "a request records the return opening one day later");
        assertEq(_store.returnAtMap(_owner, address(usdc)), _returnAt);

        vm.warp(_returnAt - 1);
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__ReturnNotReady.selector, _returnAt));
        vm.prank(master);
        _gate.returnEscrow(address(usdc));
        _settleOwnerTotal(_gate, 15e6, "");

        vm.warp(_returnAt);
        vm.recordLogs();
        vm.prank(master);
        _gate.returnEscrow(address(usdc));
        (_record,) = _execution(vm.getRecordedLogs(), _owner, 0);
        (,, uint _returned) = abi.decode(_record, (bytes4, address, uint));
        assertEq(
            usdc.balanceOf(master) - _wallet,
            25e6,
            "a day on, only the escrow still open returns to the wallet, never the total the owner signed during the day"
        );
        assertEq(_returned, 25e6, "the record carries the returned running total");
        assertEq(_store.returnedMap(_owner, address(usdc)), 25e6, "as the store keeps it");
        assertEq(_store.escrowedMap(_owner, address(usdc)), _escrowed, "while the escrowed total never falls");
        assertEq(_store.returnAtMap(_owner, address(usdc)), 0, "and the request is spent");

        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__ReturnNotReady.selector, 0));
        vm.prank(master);
        _gate.returnEscrow(address(usdc));
        _settleOwnerTotal(_gate, 20e6, abi.encodeWithSelector(Error.Balance__InsufficientBalance.selector, 0, 20e6));

        usdc.mint(master, 40e6);
        vm.startPrank(master);
        usdc.approve(address(depositModule), 40e6);
        _gate.depositEscrow(address(usdc), 40e6);
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(Error.Escrow__ReturnNotReady.selector, 0));
        vm.prank(master);
        _gate.returnEscrow(address(usdc));
        vm.prank(master);
        _gate.requestReturn(address(usdc));
        vm.warp(_returnAt + ESCROW_RETURN_DELAY);
        vm.prank(master);
        _gate.returnEscrow(address(usdc));
        assertEq(usdc.balanceOf(master) - _wallet, 65e6, "a fresh deposit returns only on a request of its own, a day later");
        assertEq(_store.returnedMap(_owner, address(usdc)), 65e6);

        vm.prank(master);
        _gate.requestReturn(address(usdc));
        vm.warp(_returnAt + 2 * ESCROW_RETURN_DELAY);
        vm.expectRevert(Error.Balance__NothingToWithdraw.selector);
        vm.prank(master);
        _gate.returnEscrow(address(usdc));
    }

    function test_an_owner_escrow_returns_only_its_open_rest_to_the_wallet_a_day_after_the_request_on_both_gates() public {
        _open();
        _depositEscrow(address(usdc), 100e6);
        _fulfil(address(usdc), 60e6, FEE);
        _returnsOnlyTheOpenRestADayAfterTheRequest(LiquidityGate(address(spoke)), spokeEscrowStore);

        assertEq(hubEscrowStore.releasedMap(_account(master), address(usdc)), 500e6, "the opening round released the hub escrow");
        _escrowOnHub(address(usdc), 40e6);
        _returnsOnlyTheOpenRestADayAfterTheRequest(LiquidityGate(address(hub)), hubEscrowStore);
    }
}
