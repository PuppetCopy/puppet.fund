// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {LibClone} from "solady/utils/LibClone.sol";

import {HubGate, MANDATE_INTENT_TYPEHASH, MAX_SKIN, SELL_INTENT_TYPEHASH} from "src/HubGate.sol";
import {Fund, PRICE_PRECISION, VIRTUAL_SHARES, VIRTUAL_VALUE} from "src/core/Fund.sol";
import {FundAccount} from "src/core/FundAccount.sol";
import {FundStore, isOpen} from "src/core/FundStore.sol";
import {Redeem} from "src/core/Redeem.sol";
import {GRID_BYTES, ShareToken} from "src/core/ShareToken.sol";
import {Error} from "src/utils/Error.sol";
import {AccountLib} from "src/utils/AccountLib.sol";
import {RETURN_ESCROW_TYPEHASH} from "src/utils/LiquidityGate.sol";
import {MandateLib} from "src/utils/MandateLib.sol";
import {HotPathTest} from "./HotPath.t.sol";

contract ScenariosTest is HotPathTest {
    uint constant NMAX = 6;
    uint constant DFN = 4;
    uint constant BILLED = FEE * USD;
    uint constant BASIS = 1e18;
    address constant SINK = address(0x51AC);

    struct LfHolder {
        uint shares;
        uint queued;
        uint cost;
        uint allocatedAt;
        uint redeemedAt;
        uint usdc;
        uint weth;
        uint basis;
        uint entries;
        bool mandated;
    }

    struct LfRound {
        uint slice;
        uint supply;
        uint nav;
        uint masterShares;
        uint contributed;
        uint masterBilled;
        uint minted;
        uint rows;
        uint[] shares;
    }

    struct LfOpen {
        uint fraction;
        uint join;
        uint masterPart;
        uint owed;
        uint cash;
        uint value;
        bool full;
        uint nav;
        uint base;
        uint pot;
        uint masterPay;
    }

    struct DfExit {
        uint nav;
        uint base;
        uint price;
        uint masterValue;
        uint owner;
        uint fees;
        uint cuts;
        uint[DFN] shares;
        uint[DFN] claim;
        uint[DFN] weth;
    }

    uint rng;

    uint lfN;
    uint lfStep;
    string lfTrace;
    address[NMAX] lfUsers;
    uint[NMAX] lfKeys;
    address[NMAX] lfAccts;
    MandateLib.Mandate[NMAX] lfMandates;
    LfHolder[NMAX] lfHolder;
    FundStore.Redemption lfRedemption;
    uint lfSupply;
    uint lfMasterShares;
    uint lfBodyUsdc;
    uint lfBodyWeth;
    uint lfBodyNative;
    uint lfFeeUsdc;
    uint lfFeeWeth;
    uint lfProtocolWeth;
    uint lfOwnerUsdc;
    uint lfOwnerWeth;
    uint lfEscrowUsdc;
    uint lfNav;
    uint lfBase;
    uint lfExo;
    address[] lfTracked;
    uint lfOtherFenced;
    uint lfOtherCost;
    uint lfOtherPrice;
    ShareToken lfOtherShare;
    address lfOtherBody;
    address lfOtherMaster;
    address lfOtherUser;
    address lfOtherAcct;

    address[DFN] dfUsers;
    uint[DFN] dfKeys;
    address[DFN] dfAccts;
    MandateLib.Mandate dfTerms;
    uint[DFN] dfBasis;
    uint[DFN] dfEntries;

    function _openFund(
        bytes32 _symbol
    ) internal {
        _escrowOnHub(address(usdc), 500e6);
        bytes memory _pixels = new bytes(GRID_BYTES);
        shareToken = ShareToken(
            LibClone.predictDeterministicAddress(
                fundModule.shareImpl(),
                abi.encodePacked(body, _symbol, _pixels, uint16(PERFORMANCE_FEE)),
                bytes32(uint(uint160(body))),
                address(hub)
            )
        );
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(0, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), body, _account(master));
        hub.createFund(_symbol, _pixels, _coSig(bodyKey, _genesis), _fundApproval(masterKey, body), _i, _sig, _ownerCoSig(_i));
    }

    function _terms(
        uint _skin
    ) internal view returns (MandateLib.Mandate memory) {
        return MandateLib.Mandate({
            master: body, skin: _skin, allocationRate: 5000, exitCap: 10_000, cooldownPeriod: 0, expiry: block.timestamp + 365 days
        });
    }

    function _mandateIntent(
        address _user,
        uint _key,
        MandateLib.Mandate memory _m
    ) internal returns (HubGate.MandateIntent memory i_, bytes memory sig_) {
        address _acct = accountModule.predictUserAccount(_user);
        MandateLib.Mandate[] memory _list = new MandateLib.Mandate[](1);
        _list[0] = _m;
        bytes[] memory _sigs = new bytes[](1);
        _sigs[0] = _mandateSig(_key, _acct, _m);
        i_ = HubGate.MandateIntent({
            header: _header(_acct, _user, _nonceOf(_acct)),
            mandateList: _list,
            signatureList: _sigs
        });
        sig_ = _pair(
            _key,
            _typed(
                _acct,
                i_.header.deadline,
                keccak256(
                    abi.encode(
                        MANDATE_INTENT_TYPEHASH,
                        _hashHeader(i_.header),
                        keccak256(abi.encode(_list))
                    )
                )
            )
        );
    }

    function _signMandate(
        address _user,
        uint _key,
        MandateLib.Mandate memory _m
    ) internal {
        (HubGate.MandateIntent memory _i, bytes memory _sig) = _mandateIntent(_user, _key, _m);
        hub.mandate(_i, _sig);
    }

    function _one(
        address _puppet,
        MandateLib.Mandate memory _m,
        uint _amount
    ) internal view returns (Fund.Allocation[] memory rows_) {
        rows_ = new Fund.Allocation[](1);
        rows_[0] = _row(_puppet, _m, _amount);
    }

    function _spot() internal pure returns (Fund.Price memory) {
        return Fund.Price({amount: 1 ether, value: ETH_USD * USD});
    }

    function _bodyValue() internal view returns (uint) {
        return usdc.balanceOf(body) * USD + wnt.balanceOf(body) + body.balance;
    }

    function _toWeth(
        uint _usdcAmount
    ) internal {
        vm.prank(body);
        IERC20(address(usdc)).transfer(SINK, _usdcAmount);
        _wethTo(body, _usdcAmount * USD);
    }

    function _toWethAll() internal {
        uint _held = usdc.balanceOf(body);
        if (_held > 0) _toWeth(_held);
    }

    function _rand() internal returns (uint) {
        rng = uint(keccak256(abi.encode(rng)));
        return rng;
    }

    function test_opening_round_is_signed_at_body_nonce_zero() public {
        _fundWallet(master, 2000e6);
        _escrowOnHub(address(usdc), 600e6);
        bytes32 _symbol = bytes32("ZERO");
        bytes memory _pixels = new bytes(GRID_BYTES);
        shareToken = ShareToken(
            LibClone.predictDeterministicAddress(
                fundModule.shareImpl(),
                abi.encodePacked(body, _symbol, _pixels, uint16(PERFORMANCE_FEE)),
                bytes32(uint(uint160(body))),
                address(hub)
            )
        );
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), body, _account(master));
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(1, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Account__NonceMismatch.selector, body, 0, 1));
        hub.createFund(_symbol, _pixels, _coSig(bodyKey, _genesis), _fundApproval(masterKey, body), _i, _sig, _ownerSig);

        uint _feeBefore = usdc.balanceOf(feeReceiver);
        (_i, _sig) = _allocateIntent(0, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        hub.createFund(_symbol, _pixels, _coSig(bodyKey, _genesis), _fundApproval(masterKey, body), _i, _sig, _ownerCoSig(_i));
        assertEq(FundAccount(payable(body)).nonce(), 1, "the opening round spends body nonce zero");
        assertEq(shareToken.balanceOf(body), 499e18, "the escrow net of the round fee mints one share unit per wei of value");
        assertEq(shareToken.totalSupply(), 499e18, "the master holds the whole supply");
        assertEq(usdc.balanceOf(body), 499e6, "the escrow lands in the body net of the fee");
        assertEq(usdc.balanceOf(feeReceiver) - _feeBefore, FEE, "the fee is billed from the owner's credit");
        assertEq(
            hubEscrowStore.releasedMap(_account(master), address(usdc)),
            500e6,
            "the opening round releases the stake from the owner's hub escrow"
        );
        assertEq(usdc.balanceOf(address(hubEscrowStore)), 100e6, "and keeps only what the round did not credit");
        assertEq(usdc.balanceOf(_account(master)), 2000e6, "leaving the owner's account alone");

        address _owner = _account(master);
        uint _deadline = block.timestamp + 300;
        bytes memory _returnSig = _coSig(
            attestorKey,
            AccountLib.typedDigest(
                block.chainid,
                _owner,
                keccak256(abi.encode(RETURN_ESCROW_TYPEHASH, address(hubEscrowStore), address(usdc), 0, 100e6, _deadline))
            )
        );
        hub.returnEscrow(_owner, address(usdc), 0, 100e6, _deadline, _returnSig);
        assertEq(usdc.balanceOf(master), 100e6, "the unused escrow returns to the owner's wallet");
        assertEq(usdc.balanceOf(_owner), 2000e6, "not to its account");
        assertEq(usdc.balanceOf(address(hubEscrowStore)), 0, "and the hub escrow holds nothing more");
    }

    function test_skin_caps_each_backer_against_the_master_alone_and_ignores_the_crowd() public {
        _openFund("AR");
        (address _g, uint _gKey) = makeAddrAndKey("ar-griefer");
        _fundWallet(_g, 40e6);
        (HubGate.MandateIntent memory _mi, bytes memory _ms) = _mandateIntent(_g, _gKey, _terms(MAX_SKIN + 1));
        vm.expectRevert(abi.encodeWithSelector(Error.Mandate__InvalidSkin.selector, MAX_SKIN + 1));
        hub.mandate(_mi, _ms);

        MandateLib.Mandate memory _half = _terms(5000);
        _signMandate(_g, _gKey, _half);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _one(_account(_g), _half, 15e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(_account(_g)), 14e18, "the dust backer is minted");
        assertEq(
            fundStore.getHolding(body, _account(_g)).cost, PRICE_PRECISION, "at the round's price of one ETH of value per share"
        );

        (address _a, uint _aKey) = makeAddrAndKey("ar-normal");
        _fundWallet(_a, 1000e6);
        _signMandate(_a, _aKey, _half);
        (_i, _sig) = _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _one(_account(_a), _half, 251e6));
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);
        (_i, _sig) = _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _one(_account(_a), _half, 250e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(_account(_a)), 249e18, "a backer fills half of the master's own shares");
        assertEq(shareToken.balanceOf(body), 499e18, "the master's shares are untouched");
        assertGt(
            shareToken.totalSupply() - shareToken.balanceOf(body),
            shareToken.balanceOf(body) / 2,
            "the crowd together holds more than any one backer's cap"
        );
        assertEq(wnt.balanceOf(address(fundStore)), 0, "and nothing is parked in a store");

        (address _z, uint _zKey) = makeAddrAndKey("ar-skinless");
        _fundWallet(_z, 2000e6);
        MandateLib.Mandate memory _bare = _terms(0);
        _signMandate(_z, _zKey, _bare);
        (_i, _sig) = _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _one(_account(_z), _bare, 900e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(_account(_z)), 899e18, "a skin of zero asks no master stake of the round");
        assertGt(shareToken.balanceOf(_account(_z)), shareToken.balanceOf(body), "so its backer may outgrow the master");
    }

    function test_revoking_one_mandate_keeps_the_other_and_a_revoked_row_skips() public {
        _openFund("RV");
        (address _a, uint _aKey) = makeAddrAndKey("ar-revoke");
        _fundWallet(_a, 1000e6);
        address _acct = _account(_a);
        MandateLib.Mandate memory _ma = _terms(MAX_SKIN);
        _signMandate(_a, _aKey, _ma);
        assertEq(mandateStore.mandateMap(_acct, body), this.digestOf(_acct, _ma), "the mandate digest is stored");

        MandateLib.Mandate memory _other = MandateLib.Mandate({
            master: address(0xBEEF), skin: 0, allocationRate: 5000, exitCap: 10_000, cooldownPeriod: 0, expiry: block.timestamp + 1 days
        });
        _signMandate(_a, _aKey, _other);
        assertEq(mandateStore.mandateMap(_acct, address(0xBEEF)), this.digestOf(_acct, _other), "a second fund is mandated");
        _other.expiry = 0;
        _signMandate(_a, _aKey, _other);
        assertEq(mandateStore.mandateMap(_acct, address(0xBEEF)), bytes32(0), "an expiry of zero is a revoke");
        assertEq(mandateStore.mandateMap(_acct, body), this.digestOf(_acct, _ma), "the other fund's mandate stands");

        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _one(_acct, _ma, 400e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        assertEq(shareToken.balanceOf(_acct), 399e18, "the standing mandate allocates");

        Fund.Allocation[] memory _rows = _one(_acct, _ma, 100e6);
        _signMandate(
            _a,
            _aKey,
            MandateLib.Mandate({
                master: body, skin: 0, allocationRate: 5000, exitCap: 10_000, cooldownPeriod: 0, expiry: 0
            })
        );
        assertEq(mandateStore.mandateMap(_acct, body), bytes32(0), "the backer revokes the fund");
        (_i, _sig) = _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _rows);
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig, _ownerSig);
    }

    function _queueRedeemAt(
        uint _value,
        address[] memory _holderList
    ) internal returns (uint paid_) {
        uint[] memory _held = new uint[](_holderList.length);
        for (uint _k; _k < _holderList.length; ++_k) {
            _held[_k] = wnt.balanceOf(_holderList[_k]);
        }
        uint[4] memory _b =
            [wnt.balanceOf(body), wnt.balanceOf(feeReceiver), wnt.balanceOf(master), wnt.balanceOf(protocolReceiver)];
        uint _pot = Math.mulDiv(
            fundStore.getRedemption(body).queued, _value + VIRTUAL_VALUE, shareToken.totalSupply() + VIRTUAL_SHARES
        );
        _redeemAt(_value, _holderList);
        for (uint _k; _k < _holderList.length; ++_k) {
            paid_ += wnt.balanceOf(_holderList[_k]) - _held[_k];
        }
        assertGe(_pot, 10 * BILLED, "these redemptions move at least ten relay fees");
        assertEq(_b[0] - wnt.balanceOf(body), _pot, "the body pays exactly the queue's value in WETH");
        assertEq(
            _pot,
            paid_ + wnt.balanceOf(feeReceiver) - _b[1] + wnt.balanceOf(master) - _b[2] + wnt.balanceOf(protocolReceiver)
                - _b[3],
            "every wei reaches a seller, the fee receiver, the master's share of a fee or the protocol's cut"
        );
        assertEq(wnt.balanceOf(address(fundStore)), 0, "and nothing stays ring-fenced once every seller is listed");
    }

    function _redeemAt(
        uint _value,
        address[] memory _holderList
    ) internal {
        Fund.Valuation memory _v = _valuation(0);
        _v.assetList[0].value = _value;
        _redeem(0, 0, _v, _holderList);
    }

    function _backer(
        string memory _tag,
        uint _amount
    ) internal returns (address user_, uint key_, address acct_) {
        (user_, key_) = makeAddrAndKey(_tag);
        _fundWallet(user_, 1000e6);
        acct_ = _account(user_);
        MandateLib.Mandate memory _m = _terms(MAX_SKIN);
        _signMandate(user_, key_, _m);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(_nonceOf(body), _nav(), _one(acct_, _m, _amount));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
    }

    function test_rounds_in_two_canonical_tokens_price_shares_by_value_and_a_redemption_pays_weth_pro_rata() public {
        _openFund("MT");
        (address _a, uint _aKey) = makeAddrAndKey("rt-a");
        (address _b, uint _bKey) = makeAddrAndKey("rt-b");
        (address _c, uint _cKey) = makeAddrAndKey("rt-c");
        _fundWallet(_a, 1000e6);
        _fundWallet(_b, 10e6);
        _fundWallet(_c, 10e6);
        _wethTo(_account(_b), 3000e18);
        _wethTo(_account(_c), 3000e18);
        MandateLib.Mandate memory _m = _terms(MAX_SKIN);
        _signMandate(_a, _aKey, _m);
        _signMandate(_b, _bKey, _m);
        _signMandate(_c, _cKey, _m);

        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(_nonceOf(body), _nav(), _one(_account(_a), _m, 400e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        uint _sharesA = shareToken.balanceOf(_account(_a));
        assertEq(_sharesA, 399e18, "a USDC row mints its value net of its relay slice at one share unit per wei");
        assertEq(fundStore.getHolding(body, _account(_a)).cost, PRICE_PRECISION, "and keeps that price as its cost");

        (_i, _sig) = _allocateIntent(
            _nonceOf(body), _nav(), address(wnt), _spot(), _credit(block.chainid, address(usdc), 10e6), new Fund.Allocation[](0)
        );
        bytes memory _ownerSig = _ownerCoSig(_i);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__CreditTokenMismatch.selector, address(usdc), address(wnt)));
        hub.allocate(_i, _sig, _ownerSig);

        uint _sharesB = _wethRound(_account(_b), _account(_c), _m);
        _sell(_a, _aKey, _sharesA);
        _sell(_b, _bKey, _sharesB);
        assertEq(_queuedOf(_account(_a)), _sharesA, "a sell queues its shares");
        _redeemThenClose(_account(_a), _account(_b), _sharesA, _sharesB);
    }

    function _wethRound(
        address _bAcct,
        address _cAcct,
        MandateLib.Mandate memory _m
    ) internal returns (uint sharesB_) {
        uint _slice = FEE * USD / 2;
        uint _feeWeth = wnt.balanceOf(feeReceiver);
        Fund.Allocation[] memory _rows = new Fund.Allocation[](2);
        bool _bFirst = uint160(_bAcct) < uint160(_cAcct);
        _rows[0] = _row(_bFirst ? _bAcct : _cAcct, _m, _bFirst ? 600e18 : 1800e18);
        _rows[1] = _row(_bFirst ? _cAcct : _bAcct, _m, _bFirst ? 1800e18 : 600e18);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(_nonceOf(body), _nav(), address(wnt), _spot(), _credit(0, address(0), 0), _rows);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        sharesB_ = shareToken.balanceOf(_bAcct);
        assertEq(sharesB_, 600e18 - _slice, "a WETH row mints at the round price, the same share value as USDC");
        assertEq(
            fundStore.getHolding(body, _bAcct).cost, PRICE_PRECISION, "so a WETH row keeps the same cost as a USDC row of its round"
        );
        assertEq(shareToken.balanceOf(_cAcct), 0, "a row above the backer's allocation rate is skipped");
        assertEq(wnt.balanceOf(_cAcct), 3000e18, "and keeps its WETH");
        assertEq(wnt.balanceOf(feeReceiver) - _feeWeth, _slice, "only the minted row's slice is billed, in WETH");
        assertEq(wnt.balanceOf(body), 600e18 - _slice, "the body keeps the WETH net of that slice");
    }

    function _redeemThenClose(
        address _aAcct,
        address _bAcct,
        uint _sharesA,
        uint _sharesB
    ) internal {
        _toWethAll();
        uint _owner = wnt.balanceOf(master);
        uint _net = _queueRedeemAt(_bodyValue(), _list(_aAcct, _bAcct));
        assertEq(fundStore.getRedemption(body).price, PRICE_PRECISION, "the fund exits at the price both holders paid");
        assertEq(wnt.balanceOf(master), _owner, "so neither pays a fee and the master earns nothing");
        assertApproxEqAbs(
            wnt.balanceOf(_aAcct) + BILLED,
            Math.mulDiv(_net + 2 * BILLED, _sharesA, _sharesA + _sharesB),
            1,
            "the redemption pays A its share of the pot"
        );
        assertApproxEqAbs(
            wnt.balanceOf(_bAcct) - 2400e18 + BILLED,
            Math.mulDiv(_net + 2 * BILLED, _sharesB, _sharesA + _sharesB),
            1,
            "and B its share, whatever its round token"
        );
        assertEq(fundStore.getRedemption(body).queued, 0, "the queue is drained");

        uint[2] memory _before = [wnt.balanceOf(master), wnt.balanceOf(body)];
        Fund.Valuation memory _v = _valuation(0);
        _v.assetList[0].value = _before[1];
        _redeem(10_000, 0, _v, new address[](0));
        assertEq(shareToken.totalSupply(), 0, "with every backer paid out, the master closes the fund");
        assertEq(wnt.balanceOf(body), 0, "paying out its whole WETH balance");
        assertEq(wnt.balanceOf(master) - _before[0], _before[1] - BILLED, "to the owner's wallet net of the relay fee");
    }

    function test_steady_sells_redeem_one_round_at_a_time_forever() public {
        _openFund("ST");
        (address _a, uint _aKey, address _acct) = _backer("ee-steady", 400e6);
        _toWethAll();
        for (uint _k; _k < 40; ++_k) {
            _sell(_a, _aKey, 8e18);
            uint _paid = wnt.balanceOf(_acct);
            uint _owner = wnt.balanceOf(master);
            _redeemAt(_bodyValue(), _list(_acct));
            assertEq(fundStore.getRedemption(body).queued, 0, "every redemption empties the queue");
            assertEq(
                wnt.balanceOf(_acct) - _paid, 8e18 - BILLED, "and pays the seller its shares at the unchanged price, with no fee on no gain"
            );
            assertEq(wnt.balanceOf(master), _owner, "so the master is paid nothing");
            assertFalse(isOpen(fundStore.getRedemption(body)), "in the one transaction that opened it");
        }
        assertEq(fundStore.getRedemption(body).id, 40, "one redemption per sale, however long the fund runs");
        assertEq(shareToken.balanceOf(_acct), 399e18 - 40 * 8e18);
    }

    function test_a_backer_exits_in_full_at_a_loss_at_the_open_price() public {
        _openFund("SD");
        (address _a, uint _aKey, address _acct) = _backer("sd-a", 400e6);
        _toWethAll();
        vm.prank(body);
        wnt.transfer(SINK, 300e18);
        _sell(_a, _aKey, 399e18);
        uint _value = _bodyValue();
        uint _owedValue = Math.mulDiv(399e18, _value + VIRTUAL_VALUE, shareToken.totalSupply() + VIRTUAL_SHARES);
        assertLt(_owedValue, 399e18, "the fund lost value since the backer joined");
        uint[3] memory _before = [wnt.balanceOf(feeReceiver), wnt.balanceOf(protocolReceiver), wnt.balanceOf(master)];
        _queueRedeemAt(_value, _list(_acct));
        assertEq(wnt.balanceOf(_acct), _owedValue - BILLED, "the backer is paid its shares at the lower price, less one fee");
        assertGt(
            fundStore.getHolding(body, _acct).cost, fundStore.getRedemption(body).price, "it exits below the price it paid"
        );
        assertEq(wnt.balanceOf(feeReceiver) - _before[0], BILLED, "so the fee receiver takes the relay fee");
        assertEq(wnt.balanceOf(protocolReceiver), _before[1], "the protocol receiver takes no cut");
        assertEq(wnt.balanceOf(master), _before[2], "and the master earns nothing on a loss");
        assertEq(shareToken.balanceOf(_acct), 0, "nothing of it stays in the fund");
        assertEq(_queuedOf(_acct), 0);
    }

    function test_each_holder_pays_the_fee_on_its_own_gain_and_the_master_collects_it_at_the_close() public {
        _openFund("EQ");
        address[] memory _all = new address[](3);
        address[3] memory _user;
        uint[3] memory _key;
        (_user[0], _key[0], _all[0]) = _backer("eq-early", 400e6);
        (_user[1], _key[1], _all[1]) = _backer("eq-twice", 200e6);
        usdc.mint(body, shareToken.totalSupply() / 2 / USD);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(_nonceOf(body), _nav(), _one(_all[1], _terms(MAX_SKIN), 300e6));
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        (_user[2], _key[2], _all[2]) = _backer("eq-late", 301e6);
        uint[3] memory _cost;
        uint[3] memory _shares;
        for (uint _k; _k < 3; ++_k) {
            _cost[_k] = fundStore.getHolding(body, _all[_k]).cost;
            _shares[_k] = shareToken.balanceOf(_all[_k]);
        }
        assertEq(_cost[0], PRICE_PRECISION, "the early holder paid one ETH of value per share");
        assertEq(_cost[1], 498e18 * PRICE_PRECISION / _shares[1], "a holder that entered twice keeps the average it paid per share");
        assertApproxEqRel(_cost[2], PRICE_PRECISION * 3 / 2, 1e9, "the late holder paid the risen price of one and a half");
        assertTrue(_cost[0] < _cost[1] && _cost[1] < _cost[2], "so the three hold three different costs");

        uint _drop = usdc.balanceOf(body) - (Math.mulDiv(shareToken.totalSupply() + VIRTUAL_SHARES, 13, 10) - VIRTUAL_VALUE) / USD;
        vm.prank(body);
        IERC20(address(usdc)).transfer(SINK, _drop);
        _toWethAll();
        for (uint _k; _k < 3; ++_k) {
            _sell(_user[_k], _key[_k], _shares[_k]);
        }

        uint _value = _bodyValue();
        uint _owed = (_shares[0] + _shares[1] + _shares[2]) * 1e4;
        uint _pot = Math.mulDiv(_owed, _value + VIRTUAL_VALUE, (shareToken.totalSupply() + VIRTUAL_SHARES) * 1e4);
        uint _price = Math.mulDiv((_value + VIRTUAL_VALUE) * PRICE_PRECISION, 1, shareToken.totalSupply() + VIRTUAL_SHARES);
        uint[3] memory _payout;
        _payout[2] = Math.mulDiv(_pot, _shares[2] * 1e4, _owed);
        _payout[0] = Math.mulDiv(_pot - _payout[2], _shares[0] * 1e4, _owed - _shares[2] * 1e4);
        _payout[1] = _pot - _payout[2] - _payout[0];
        uint[6] memory _before = [
            wnt.balanceOf(_all[0]),
            wnt.balanceOf(_all[1]),
            wnt.balanceOf(_all[2]),
            wnt.balanceOf(master),
            wnt.balanceOf(feeReceiver),
            wnt.balanceOf(protocolReceiver)
        ];
        _redeemAt(_value, _list(_all[2]));
        assertEq(fundStore.getRedemption(body).price, _price, "the open prices a share at the fund's value per share");
        assertTrue(_cost[1] < _price && _price < _cost[2], "the exit sits above two entries and below the third");
        assertEq(
            wnt.balanceOf(_all[2]) - _before[2], _payout[2] - BILLED, "a holder at a loss is paid its claim less only the relay fee"
        );
        assertTrue(isOpen(fundStore.getRedemption(body)), "the others are still owed");
        assertEq(wnt.balanceOf(master), _before[3], "so nothing reaches the master yet");

        hub.redeemCohort(shareToken, _all);
        uint[2] memory _paid = [uint(399e18), 498e18];
        uint _masterPay;
        uint _cuts;
        for (uint _k; _k < 2; ++_k) {
            uint _fee = Math.mulDiv(_payout[_k], PERFORMANCE_FEE * (_price - _cost[_k]), _price * 1e4);
            assertApproxEqRel(
                _fee,
                (_payout[_k] - _paid[_k]) * PERFORMANCE_FEE / 1e4,
                1e9,
                "each holder's fee is a tenth of its own gain over everything it paid in"
            );
            assertEq(
                wnt.balanceOf(_all[_k]) - _before[_k], _payout[_k] - _fee - BILLED, "and it keeps the rest of its claim less the relay fee"
            );
            uint _cut = Math.mulDiv(_fee, PROTOCOL_FEE_SHARE, 1e4);
            _masterPay += _fee - _cut;
            _cuts += _cut;
        }
        assertEq(
            wnt.balanceOf(master) - _before[3],
            _masterPay - BILLED,
            "the master's part of both fees reaches the owner's wallet at the close, less one relay fee"
        );
        assertEq(wnt.balanceOf(feeReceiver) - _before[4], 4 * BILLED, "the fee receiver collects four relay fees alone");
        assertEq(
            wnt.balanceOf(protocolReceiver) - _before[5], _cuts, "and the protocol receiver the protocol's tenth of each fee"
        );
        assertFalse(isOpen(fundStore.getRedemption(body)), "the overlapping cohort settles the rest and closes");
        assertEq(wnt.balanceOf(address(fundStore)), 0, "leaving nothing in the store");

        uint[2] memory _close = [wnt.balanceOf(master), wnt.balanceOf(body)];
        Fund.Valuation memory _v = _valuation(0);
        _v.assetList[0].value = _close[1];
        _redeem(10_000, 0, _v, new address[](0));
        assertEq(
            wnt.balanceOf(master) - _close[0], _close[1] - BILLED, "the master's own shares exit at the fund's cash with no fee"
        );
        assertEq(shareToken.totalSupply(), 0, "and the fund closes");
    }

    function _lfEq(
        uint _a,
        uint _b,
        string memory _what
    ) internal view {
        if (_a != _b) assertEq(_a, _b, string.concat(_what, ". trace=", lfTrace));
    }

    function _lfTrue(
        bool _ok,
        string memory _what
    ) internal view {
        if (!_ok) assertTrue(_ok, string.concat(_what, ". trace=", lfTrace));
    }

    function _lfApprox(
        uint _a,
        uint _b,
        uint _tolerance,
        string memory _what
    ) internal view {
        if ((_a > _b ? _a - _b : _b - _a) > _tolerance) {
            assertApproxEqAbs(_a, _b, _tolerance, string.concat(_what, ". trace=", lfTrace));
        }
    }

    function _lfLog(
        string memory _s
    ) internal {
        lfTrace = string.concat(lfTrace, vm.toString(lfStep), ":", _s, " | ");
    }

    function _lfIndex(
        address _acct
    ) internal view returns (uint j_) {
        while (lfAccts[j_] != _acct) ++j_;
    }

    function _lfBodyValue() internal view returns (uint) {
        return lfBodyUsdc * USD + lfBodyWeth + lfBodyNative;
    }

    function _lfEvery() internal view returns (address[] memory list_) {
        list_ = new address[](lfN);
        for (uint _j; _j < lfN; ++_j) {
            list_[_j] = lfAccts[_j];
        }
    }

    function _lfMask() internal returns (address[] memory list_) {
        uint _mask = _rand() % 2 ** lfN;
        uint _count;
        for (uint _j; _j < lfN; ++_j) {
            if ((_mask >> _j) & 1 == 1) ++_count;
        }
        list_ = new address[](_count);
        uint _n;
        for (uint _j; _j < lfN; ++_j) {
            if ((_mask >> _j) & 1 == 1) list_[_n++] = lfAccts[_j];
        }
        if (_count > 1 && _rand() % 2 == 0) {
            for (uint _k; _k < _count / 2; ++_k) {
                (list_[_k], list_[_count - 1 - _k]) = (list_[_count - 1 - _k], list_[_k]);
            }
        }
    }

    function _lfOtherFund() internal {
        (address _body, uint _bodyKey, address _master, uint _masterKey, ShareToken _share) =
            (body, bodyKey, master, masterKey, shareToken);
        (master, masterKey) = makeAddrAndKey("lf-other-master");
        (body, bodyKey) = makeAddrAndKey("lf-other-body");
        vm.signAndAttachDelegation(accountModule.bodyImpl(), bodyKey);
        _openFund("LFO");
        (address _user, uint _key, address _acct) = _backer("lf-other-backer", 400e6);
        usdc.mint(body, 1e6 + _rand() % 400e6);
        _sell(_user, _key, shareToken.balanceOf(_acct));
        _toWethAll();
        _redeemAt(_bodyValue(), new address[](0));
        FundStore.Redemption memory _r = fundStore.getRedemption(body);
        lfOtherFenced = wnt.balanceOf(address(fundStore));
        assertEq(lfOtherFenced, _r.potLeft, "the other fund leaves its seller's pot ring-fenced in the shared store");
        assertGt(lfOtherFenced, 0);
        lfOtherPrice = _r.price;
        lfOtherCost = fundStore.getHolding(body, _acct).cost;
        assertLt(lfOtherCost, lfOtherPrice, "the other fund gained since its seller joined");
        (lfOtherShare, lfOtherBody, lfOtherMaster, lfOtherUser, lfOtherAcct) = (shareToken, body, master, _user, _acct);
        (body, bodyKey, master, masterKey, shareToken) = (_body, _bodyKey, _master, _masterKey, _share);
    }

    function _lfSetup(
        uint _n,
        uint _seed,
        bool _extended
    ) internal {
        lfN = _n;
        if (_extended) _lfOtherFund();
        _openFund("LF");
        uint[5] memory _skins = [MAX_SKIN, 20_000, 1000, 5000, 0];
        for (uint _j; _j < _n; ++_j) {
            (lfUsers[_j], lfKeys[_j]) = makeAddrAndKey(string.concat("lf-", vm.toString(_j)));
            lfAccts[_j] = _account(lfUsers[_j]);
            _fundWallet(lfUsers[_j], 20_000e6);
            lfMandates[_j] = MandateLib.Mandate({
                master: body,
                skin: _skins[uint(keccak256(abi.encode(_seed, _j))) % 5],
                allocationRate: 9000,
                exitCap: 10_000,
                cooldownPeriod: 0,
                expiry: block.timestamp + 365 days
            });
            _signMandate(lfUsers[_j], lfKeys[_j], lfMandates[_j]);
            lfHolder[_j].usdc = 20_000e6 - FEE;
            lfHolder[_j].mandated = true;
            lfTracked.push(lfAccts[_j]);
            lfTracked.push(lfUsers[_j]);
        }
        lfSupply = 499e18;
        lfMasterShares = 499e18;
        lfBodyUsdc = 499e6;
        lfFeeUsdc = usdc.balanceOf(feeReceiver);
        lfFeeWeth = wnt.balanceOf(feeReceiver);
        lfProtocolWeth = wnt.balanceOf(protocolReceiver);
        lfTracked.push(body);
        lfTracked.push(address(fundStore));
        lfTracked.push(address(hubEscrowStore));
        lfTracked.push(master);
        lfTracked.push(_account(master));
        lfTracked.push(feeReceiver);
        lfTracked.push(protocolReceiver);
        if (_extended) {
            lfTracked.push(lfOtherBody);
            lfTracked.push(lfOtherMaster);
            lfTracked.push(_account(lfOtherMaster));
            lfTracked.push(lfOtherUser);
            lfTracked.push(lfOtherAcct);
        }
        lfExo = _lfLedger();
        _lfCheck();
    }

    function _lfLedger() internal view returns (uint value_) {
        for (uint _k; _k < lfTracked.length; ++_k) {
            value_ += _lfValueOf(lfTracked[_k]);
        }
    }

    function _lfTopUp(
        uint _j
    ) internal {
        if (lfHolder[_j].usdc >= 10e6) return;
        _fundWallet(lfUsers[_j], 1000e6);
        lfHolder[_j].usdc += 1000e6;
        lfExo += 1000e6 * USD;
    }

    function _lfToWethAll() internal {
        uint _held = lfBodyUsdc;
        if (_held == 0) return;
        _toWeth(_held);
        lfBodyUsdc = 0;
        lfBodyWeth += _held * USD;
    }

    function _lfAllocate(
        bool _every
    ) internal {
        address[] memory _list = _every ? _lfEvery() : _lfMask();
        Fund.Allocation[] memory _rows = new Fund.Allocation[](_list.length);
        for (uint _n; _n < _list.length; ++_n) {
            uint _k = _n;
            while (_k > 0 && uint160(_rows[_k - 1].puppet) > uint160(_list[_n])) {
                _rows[_k] = _rows[_k - 1];
                --_k;
            }
            _rows[_k] = _row(_list[_n], lfMandates[_lfIndex(_list[_n])], 5e6 + _rand() % 3000e6);
        }
        uint _credited = _rand() % 3 == 0 ? 10e6 + _rand() % 2000e6 : 0;
        if (_credited > 0) {
            _escrowOnHub(address(usdc), _credited);
            lfEscrowUsdc += _credited;
            lfExo += _credited * USD;
        }
        if (_rows.length == 0 && _credited == 0) return;
        LfRound memory _m = _lfRound(_rows, _credited, _lfBodyValue() / USD * USD);
        _lfLog(string.concat("alloc n=", vm.toString(_rows.length), " minted=", vm.toString(_m.rows), " credit=", vm.toString(_credited)));
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(
            _nonceOf(body),
            _lfBodyValue() / USD,
            address(usdc),
            Fund.Price({amount: 1e6, value: 1e6 * USD}),
            _credited > 0 ? _credit(block.chainid, address(usdc), _credited) : _credit(0, address(0), 0),
            _rows
        );
        bytes memory _ownerSig = _ownerCoSig(_i);
        if (isOpen(lfRedemption)) {
            vm.expectRevert(abi.encodeWithSelector(Error.Redeem__Open.selector, lfRedemption.id));
        } else if (_m.minted == 0) {
            vm.expectRevert(Error.Balance__ZeroAmount.selector);
        }
        hub.allocate(_i, _sig, _ownerSig);
        if (!isOpen(lfRedemption) && _m.minted > 0) _lfMinted(_rows, _m, _credited);
    }

    function _lfMinted(
        Fund.Allocation[] memory _rows,
        LfRound memory _m,
        uint _credited
    ) internal {
        if (_credited > 0) {
            lfEscrowUsdc -= _credited;
            lfFeeUsdc += _m.masterBilled;
            lfBodyUsdc += _credited - _m.masterBilled;
            lfMasterShares += _m.contributed;
            lfSupply += _m.contributed;
        }
        for (uint _r; _r < _rows.length; ++_r) {
            uint _shares = _m.shares[_r];
            if (_shares == 0) continue;
            LfHolder storage _h = lfHolder[_lfIndex(_rows[_r].puppet)];
            uint _net = _rows[_r].amount * USD - _m.slice;
            _h.cost = (_h.cost * _h.shares + _net * PRICE_PRECISION) / (_h.shares + _shares);
            _h.basis += _net * BASIS;
            _h.allocatedAt = block.timestamp;
            ++_h.entries;
            _h.shares += _shares;
            _h.usdc -= _rows[_r].amount;
            lfBodyUsdc += _rows[_r].amount;
            lfSupply += _shares;
        }
        uint _billed = Math.mulDiv(_m.slice * _m.rows, 1e6, 1e6 * USD);
        lfBodyUsdc -= _billed;
        lfFeeUsdc += _billed;
    }

    function _lfRound(
        Fund.Allocation[] memory _rows,
        uint _credited,
        uint _valuation
    ) internal view returns (LfRound memory m_) {
        m_.slice = BILLED / (_rows.length + (_credited > 0 ? 1 : 0));
        m_.supply = lfSupply + VIRTUAL_SHARES;
        m_.nav = _valuation + VIRTUAL_VALUE;
        m_.masterShares = lfMasterShares;
        m_.shares = new uint[](_rows.length);
        if (_credited > 0) {
            m_.masterBilled = Math.mulDiv(m_.slice, 1e6, 1e6 * USD, Math.Rounding.Ceil);
            m_.contributed = Math.mulDiv(_credited * USD - m_.slice, m_.supply, m_.nav);
            m_.masterShares += m_.contributed;
            m_.minted += m_.contributed;
        }
        uint _exiting = Math.mulDiv(lfRedemption.queued, 1e4, m_.supply, Math.Rounding.Ceil);
        for (uint _r; _r < _rows.length; ++_r) {
            uint _shares = _lfRowShares(_rows[_r], m_, _exiting);
            m_.shares[_r] = _shares;
            m_.minted += _shares;
            if (_shares > 0) ++m_.rows;
        }
    }

    function _lfRowShares(
        Fund.Allocation memory _row,
        LfRound memory _m,
        uint _exiting
    ) internal view returns (uint shares_) {
        LfHolder storage _h = lfHolder[_lfIndex(_row.puppet)];
        uint _value = _row.amount * USD;
        if (_m.slice * 1e4 >= _value * 1000 || !_h.mandated) return 0;
        uint _open = _row.mandate.exitCap > _exiting ? _row.mandate.exitCap - _exiting : 0;
        if (_open == 0 || _value * 1e4 * _row.mandate.exitCap > _h.usdc * USD * _row.mandate.allocationRate * _open) return 0;
        shares_ = Math.mulDiv(_value - _m.slice, _m.supply, _m.nav);
        if (_row.mandate.skin == 0) return shares_;
        uint _skinRoom = _m.masterShares * _row.mandate.skin;
        uint _held = _h.shares * 1e4;
        if (_skinRoom < _held || shares_ * 1e4 * _row.mandate.exitCap > (_skinRoom - _held) * _open) return 0;
    }

    function _lfRemandate() internal {
        uint _j = _rand() % lfN;
        _lfTopUp(_j);
        _signMandate(lfUsers[_j], lfKeys[_j], lfMandates[_j]);
        lfHolder[_j].usdc -= FEE;
        lfHolder[_j].mandated = true;
        lfFeeUsdc += FEE;
        _lfLog(string.concat("remandate ", vm.toString(_j)));
    }

    function _lfMarket(
        uint _op
    ) internal {
        if (_op == 0) {
            uint _amt = _rand() % (lfBodyUsdc * 3 / 10 + 1);
            usdc.mint(body, _amt);
            lfBodyUsdc += _amt;
            lfExo += _amt * USD;
            _lfLog("gain");
        } else if (_op == 1) {
            uint _amt = _rand() % (lfBodyUsdc * 3 / 10 + 1);
            vm.prank(body);
            IERC20(address(usdc)).transfer(SINK, _amt);
            lfBodyUsdc -= _amt;
            lfExo -= _amt * USD;
            _lfLog("loss");
        } else if (_op == 2) {
            uint _amt = _rand() % (lfBodyUsdc + 1);
            if (_amt > 0) _toWeth(_amt);
            lfBodyUsdc -= _amt;
            lfBodyWeth += _amt * USD;
            _lfLog("swap");
        } else if (_op == 3) {
            uint _amt = _rand() % (lfBodyWeth + 1);
            vm.prank(body);
            wnt.transfer(SINK, _amt);
            vm.deal(body, body.balance + _amt);
            lfBodyWeth -= _amt;
            lfBodyNative += _amt;
            _lfLog("native");
        } else if (_op == 4) {
            uint _amt = _rand() % 5000e18;
            _wethTo(body, _amt);
            lfBodyWeth += _amt;
            lfExo += _amt;
            _lfLog("inflow");
        } else {
            uint _amt = _rand() % (lfBodyWeth * 3 / 10 + 1);
            vm.prank(body);
            wnt.transfer(SINK, _amt);
            lfBodyWeth -= _amt;
            lfExo -= _amt;
            _lfLog("drawdown");
        }
    }

    function _lfSettle(
        uint _j,
        bool _cohort
    ) internal returns (uint fees_) {
        LfHolder storage _h = lfHolder[_j];
        FundStore.Redemption storage _r = lfRedemption;
        uint _queued = _h.queued;
        uint _free = _h.shares - _queued;
        uint _claim = _queued * 1e4 + _free * _r.fraction;
        uint _exit = _queued + _free * _r.fraction / 1e4;
        uint _payout = Math.mulDiv(_r.potLeft, _claim, _r.owedLeft);
        uint _profitFee =
            _h.cost < _r.price ? Math.mulDiv(_payout, PERFORMANCE_FEE * (_r.price - _h.cost), _r.price * 1e4) : 0;
        uint _cut = Math.mulDiv(_profitFee, PROTOCOL_FEE_SHARE, 1e4);
        if (_claim > 0) _lfIndependent(_h, _claim, _payout, _profitFee, _exit);
        _h.shares -= _exit;
        lfSupply -= _exit;
        _r.potLeft -= uint96(_payout);
        _r.owedLeft -= uint128(_claim);
        _r.queued -= uint128(_queued);
        _r.masterPay += uint96(_profitFee - _cut);
        _h.queued = 0;
        _h.redeemedAt = _r.id;
        lfProtocolWeth += _cut;
        if (!_cohort) {
            _h.weth += _payout - _profitFee;
            return 0;
        }
        if (_payout - _profitFee > _r.fee) {
            fees_ = _r.fee;
            _h.weth += _payout - _profitFee - _r.fee;
        } else {
            fees_ = _payout - _profitFee;
        }
    }

    function _lfIndependent(
        LfHolder storage _h,
        uint _claim,
        uint _payout,
        uint _profitFee,
        uint _exit
    ) internal {
        uint _atPrice = Math.mulDiv(_claim, lfNav, lfBase * 1e4);
        _lfApprox(_payout, _atPrice, lfN + 2, "every settled claim is paid at the open price");
        uint _paid = Math.mulDiv(_h.basis, _claim, _h.shares * 1e4 * BASIS);
        uint _fee = _atPrice > _paid ? (_atPrice - _paid) * PERFORMANCE_FEE / 1e4 : 0;
        _lfApprox(
            _profitFee,
            _fee,
            Math.mulDiv(_payout, _h.entries + 2, Math.max(lfRedemption.price, 1)) + lfN + 4,
            "each holder pays the fee on its own gain over what it paid for its shares"
        );
        _h.basis -= Math.mulDiv(_h.basis, _exit, _h.shares);
    }

    function _lfCohortModel(
        address[] memory _list
    ) internal {
        FundStore.Redemption storage _r = lfRedemption;
        uint _fees;
        for (uint _k; _k < _list.length && _r.potLeft > _r.fee; ++_k) {
            uint _j = _lfIndex(_list[_k]);
            LfHolder storage _h = lfHolder[_j];
            if (_h.redeemedAt == _r.id || _h.queued * 1e4 + (_h.shares - _h.queued) * _r.fraction == 0) continue;
            _fees += _lfSettle(_j, true);
        }
        bool _cutting = _r.owedLeft > 0 && _r.potLeft <= _r.fee;
        if (_cutting) {
            _lfTrue(_r.potLeft <= _r.fee, "only a cut tail of at most one fee comes back to the fund");
            lfBodyWeth += _r.potLeft;
            _r.owedLeft = 0;
            _r.potLeft = 0;
        }
        if (_cutting || (_r.owedLeft == 0 && _r.masterPay > 0)) {
            uint _masterFee = Math.min(_r.masterPay, _r.fee);
            _fees += _masterFee;
            lfOwnerWeth += _r.masterPay - _masterFee;
            _r.masterPay = 0;
        }
        lfFeeWeth += _fees;
    }

    function _lfSell() internal {
        uint _j = _rand() % lfN;
        LfHolder storage _h = lfHolder[_j];
        bool _settles = lfRedemption.owedLeft > 0 && _h.redeemedAt != lfRedemption.id;
        uint _free = _h.shares - _h.queued;
        uint _left = _free - (_settles ? _free * lfRedemption.fraction / 1e4 : 0);
        uint _shares = _left == 0 || _rand() % 8 == 0
            ? _left + 1
            : 1 + _rand() % (_rand() % 3 == 0 ? Math.min(_left, 2e18) : _left);
        _lfTopUp(_j);
        _lfLog(string.concat("sell ", vm.toString(_j), " ", vm.toString(_shares)));
        address _acct = lfAccts[_j];
        Redeem.SellIntent memory _i =
            Redeem.SellIntent({header: _header(_acct, lfUsers[_j], _nonceOf(_acct)), shareToken: shareToken, shares: _shares});
        bytes memory _sig = _pair(
            lfKeys[_j],
            _typed(
                _acct,
                _i.header.deadline,
                keccak256(abi.encode(SELL_INTENT_TYPEHASH, _hashHeader(_i.header), _i.shareToken, _i.shares))
            )
        );
        if (_shares > _left) {
            vm.expectRevert(abi.encodeWithSelector(Error.Fund__InsufficientShares.selector, _left, _shares));
            hub.sell(_i, _sig);
            return;
        }
        hub.sell(_i, _sig);
        if (_settles) _lfSettle(_j, false);
        _h.queued += _shares;
        lfRedemption.queued += uint128(_shares);
        _h.usdc -= FEE;
        _h.mandated = false;
        lfFeeUsdc += FEE;
    }

    function _lfOpen() internal {
        if (_rand() % 2 == 0) _lfToWethAll();
        FundStore.Redemption memory _r = lfRedemption;
        LfOpen memory _o;
        uint _active = lfSupply - lfMasterShares - _r.queued;
        uint _mode = _rand() % 16;
        _o.fraction = _mode < 6 ? 0 : _mode == 15 ? 10_000 : _mode > 12 ? 1 + _rand() % 50 : 1 + _rand() % 9999;
        uint _cap = _active + _r.queued > 0 ? Math.mulDiv(lfMasterShares, _r.queued, _active + _r.queued) : lfMasterShares;
        if (_mode < 3) _o.join = _rand() % (_cap + 1);
        else if (_mode == 3 && _cap < lfMasterShares) _o.join = _cap + 1;
        _o.masterPart = _o.fraction > 0 ? Math.mulDiv(lfMasterShares, _o.fraction, 1e4) : _o.join;
        _o.owed = _r.queued * 1e4 + _active * _o.fraction;
        _o.full = _o.owed + _o.masterPart * 1e4 == lfSupply * 1e4;
        if (_o.full && _rand() % 4 != 0) _lfToWethAll();
        _o.cash = lfBodyWeth + lfBodyNative;
        _o.value = _lfBodyValue();
        _o.nav = _o.full ? _o.cash : _o.value + VIRTUAL_VALUE;
        _o.base = _o.full ? lfSupply : lfSupply + VIRTUAL_SHARES;
        if (_o.owed + _o.masterPart > 0) {
            _o.pot = Math.mulDiv(_o.owed, _o.nav, _o.base * 1e4);
            _o.masterPay = _o.full ? _o.cash - _o.pot : Math.mulDiv(_o.masterPart, _o.nav, _o.base);
        }

        bytes memory _want;
        if (isOpen(_r)) {
            _want = abi.encodeWithSelector(Error.Redeem__Open.selector, _r.id);
        } else if (_o.join * (_active + _r.queued) > lfMasterShares * _r.queued) {
            _want = abi.encodeWithSelector(
                Error.Redeem__JoinAboveSymmetry.selector, _o.join, Math.mulDiv(lfMasterShares, _r.queued, _active + _r.queued)
            );
        } else if (_o.owed + _o.masterPart == 0) {
            _want = abi.encodeWithSelector(Error.Balance__ZeroAmount.selector);
        } else if (_o.full && _o.value > _o.cash) {
            _want = abi.encodeWithSelector(Error.Balance__InsufficientFund.selector, address(wnt), _o.cash, _o.value);
        } else if (_o.pot + _o.masterPay > _o.cash) {
            _want = abi.encodeWithSelector(Error.Balance__InsufficientFund.selector, address(wnt), _o.cash, _o.pot + _o.masterPay);
        } else if (_o.pot + _o.masterPay < BILLED) {
            _want = abi.encodeWithSelector(Error.Redeem__Dust.selector, _o.pot + _o.masterPay, BILLED);
        }

        Fund.Valuation memory _v = _valuation(0);
        _v.assetList[0].value = _o.value;
        Redeem.RedeemIntent memory _i = _redeemIntent(_o.fraction, _o.join, _v);
        bytes memory _sig = _redeemSig(_i);
        address[] memory _first = _lfMask();
        _lfLog(
            string.concat(
                "open f=",
                vm.toString(_o.fraction),
                " join=",
                vm.toString(_o.join),
                " first=",
                vm.toString(_first.length),
                _want.length > 0 ? string(" refused") : string("")
            )
        );
        if (_want.length > 0) {
            vm.expectRevert(_want);
            hub.redeem(_i, _sig, _first);
            return;
        }
        hub.redeem(_i, _sig, _first);
        lfNav = _o.nav;
        lfBase = _o.base;
        uint _out = _o.pot + _o.masterPay;
        if (_out > lfBodyWeth) {
            lfBodyNative -= _out - lfBodyWeth;
            lfBodyWeth = 0;
        } else {
            lfBodyWeth -= _out;
        }
        lfMasterShares -= _o.masterPart;
        lfSupply -= _o.masterPart;
        lfRedemption = FundStore.Redemption({
            id: _r.id + 1,
            fraction: uint32(_o.fraction),
            fee: uint64(BILLED),
            masterPay: uint96(_o.masterPay),
            queued: _r.queued,
            owedLeft: uint128(_o.owed),
            potLeft: uint96(_o.pot),
            token: address(wnt),
            price: Math.mulDiv(_o.nav * PRICE_PRECISION, 1, _o.base)
        });
        _lfCohortModel(_first);
    }

    function _lfCohort() internal {
        address[] memory _list = _lfMask();
        _lfLog(string.concat("cohort n=", vm.toString(_list.length)));
        hub.redeemCohort(shareToken, _list);
        _lfCohortModel(_list);
    }

    function _lfCheck() internal view {
        FundStore.Redemption memory _r = fundStore.getRedemption(body);
        FundStore.Redemption memory _m = lfRedemption;
        _lfEq(_r.id, _m.id, "the redemption id follows the model");
        _lfEq(_r.fraction, _m.fraction, "the fraction follows the model");
        _lfEq(_r.fee, _m.fee, "the relay fee follows the model");
        _lfEq(_r.masterPay, _m.masterPay, "the master's pay, with its part of every fee, follows the model");
        _lfEq(_r.queued, _m.queued, "the queue follows the model");
        _lfEq(_r.owedLeft, _m.owedLeft, "the claims left follow the model");
        _lfEq(_r.potLeft, _m.potLeft, "the pot left follows the model");
        _lfEq(_r.price, _m.price, "the open's price follows the model");
        _lfTrue(_r.token == _m.token, "the payout token follows the model");
        uint _queued;
        uint _held = shareToken.balanceOf(body);
        uint _owed;
        for (uint _j; _j < lfN; ++_j) {
            (uint _balance, uint _q, uint _claim) = _lfCheckHolder(_j, _r);
            _queued += _q;
            _held += _balance;
            _owed += _claim;
        }
        _lfEq(_r.queued, _queued, "the stored queue is the sum of every holder's queue");
        _lfEq(shareToken.totalSupply(), _held, "every share sits with the master or a backer");
        _lfEq(shareToken.totalSupply(), lfSupply, "the supply follows the model");
        _lfEq(shareToken.balanceOf(body), lfMasterShares, "the master's shares follow the model");
        if (_r.owedLeft > 0) _lfEq(_r.owedLeft, _owed, "the open owes exactly the live claims");
        if (!isOpen(_r)) _lfEq(_r.potLeft, 0, "a closed redemption holds no pot");
        _lfEq(
            wnt.balanceOf(address(fundStore)),
            uint(_r.potLeft) + _r.masterPay + lfOtherFenced,
            "the store holds exactly both funds' ring-fenced pay"
        );
        _lfEq(usdc.balanceOf(body), lfBodyUsdc, "the fund's USDC follows the model");
        _lfEq(wnt.balanceOf(body), lfBodyWeth, "the fund's WETH follows the model");
        _lfEq(body.balance, lfBodyNative, "the fund's native balance follows the model");
        _lfEq(usdc.balanceOf(feeReceiver), lfFeeUsdc, "the fee receiver's USDC follows the model");
        _lfEq(wnt.balanceOf(feeReceiver), lfFeeWeth, "the fee receiver's WETH, relay fees alone, follows the model");
        _lfEq(wnt.balanceOf(protocolReceiver), lfProtocolWeth, "the protocol receiver's WETH, every protocol cut, follows the model");
        _lfEq(wnt.balanceOf(master), lfOwnerWeth, "the master's wallet is paid exactly the model's master pay");
        _lfEq(usdc.balanceOf(master), lfOwnerUsdc, "the master's wallet USDC follows the model");
        _lfEq(usdc.balanceOf(address(hubEscrowStore)), lfEscrowUsdc, "the hub escrow holds exactly the unreleased credits");
        _lfEq(
            _lfLedger(),
            lfExo,
            "every wei the fund and its holders hold stays with a holder, the master, the fee receiver, the protocol receiver, the escrow or the fund"
        );
    }

    function _lfCheckHolder(
        uint _j,
        FundStore.Redemption memory _r
    ) internal view returns (uint balance_, uint queued_, uint claim_) {
        address _acct = lfAccts[_j];
        LfHolder memory _h = lfHolder[_j];
        FundStore.Holding memory _c = fundStore.getHolding(body, _acct);
        balance_ = shareToken.balanceOf(_acct);
        queued_ = _c.queued;
        _lfEq(balance_, _h.shares, "each holder's shares follow the model");
        _lfEq(queued_, _h.queued, "each holder's queue follows the model");
        _lfEq(_c.cost, _h.cost, "each holder's average entry cost follows the model");
        _lfEq(_c.allocatedAt, _h.allocatedAt, "each holder's last allocation follows the model");
        _lfEq(_c.redeemedAt, _h.redeemedAt, "each holder's last settlement follows the model");
        _lfEq(wnt.balanceOf(_acct), _h.weth, "each holder is paid exactly what the model pays it");
        _lfEq(usdc.balanceOf(_acct), _h.usdc, "each holder spends exactly what the model spends");
        _lfTrue((mandateStore.mandateMap(_acct, body) != bytes32(0)) == _h.mandated, "each holder's mandate follows the model");
        _lfTrue(balance_ >= queued_, "a holder's queue never exceeds its shares");
        if (_r.owedLeft > 0 && _c.redeemedAt != _r.id) claim_ = queued_ * 1e4 + (balance_ - queued_) * _r.fraction;
    }

    function _lfReturnEscrow() internal {
        address _owner = _account(master);
        uint _returned = hubEscrowStore.returnedMap(_owner, address(usdc));
        uint _open = hubEscrowStore.escrowedMap(_owner, address(usdc)) - hubEscrowStore.releasedMap(_owner, address(usdc)) - _returned;
        _lfEq(_open, lfEscrowUsdc, "the hub escrow holds exactly the credits no round released");
        if (_open == 0) return;
        uint _deadline = vm.getBlockTimestamp() + 300;
        bytes memory _sig = _coSig(
            attestorKey,
            AccountLib.typedDigest(
                block.chainid,
                _owner,
                keccak256(
                    abi.encode(RETURN_ESCROW_TYPEHASH, address(hubEscrowStore), address(usdc), _returned, _returned + _open, _deadline)
                )
            )
        );
        hub.returnEscrow(_owner, address(usdc), _returned, _returned + _open, _deadline, _sig);
        lfOwnerUsdc += _open;
        lfEscrowUsdc = 0;
    }

    function _lfEnd() internal {
        if (isOpen(lfRedemption)) {
            address[] memory _every = _lfEvery();
            hub.redeemCohort(shareToken, _every);
            _lfCohortModel(_every);
        }
        _lfTrue(!isOpen(fundStore.getRedemption(body)), "one cohort of every holder closes any redemption");
        _lfCheck();
        if (lfOtherFenced > 0) {
            uint _fee = Math.mulDiv(lfOtherFenced, PERFORMANCE_FEE * (lfOtherPrice - lfOtherCost), lfOtherPrice * 1e4);
            uint _cut = Math.mulDiv(_fee, PROTOCOL_FEE_SHARE, 1e4);
            uint _masterFee = Math.min(_fee - _cut, BILLED);
            uint[2] memory _before = [wnt.balanceOf(lfOtherAcct), wnt.balanceOf(lfOtherMaster)];
            hub.redeemCohort(lfOtherShare, _list(lfOtherAcct));
            _lfEq(
                wnt.balanceOf(lfOtherAcct) - _before[0],
                lfOtherFenced - _fee - BILLED,
                "the other fund's seller is paid its whole pot out of the shared store, less its own fee"
            );
            _lfEq(
                wnt.balanceOf(lfOtherMaster) - _before[1],
                _fee - _cut - _masterFee,
                "and that fund's master collects its part of the fee at the close"
            );
            _lfTrue(!isOpen(fundStore.getRedemption(lfOtherBody)), "which closes the other fund's redemption");
            lfFeeWeth += BILLED + _masterFee;
            lfProtocolWeth += _cut;
            lfOtherFenced = 0;
        }
        _lfReturnEscrow();
        _lfCheck();
        assertEq(wnt.balanceOf(address(fundStore)), 0, "the shared store ends empty");
        assertEq(usdc.balanceOf(address(hubEscrowStore)), 0, "and the hub escrow returns every credit no round used");
        uint _ends = _lfValueOf(master) + _lfValueOf(feeReceiver) + _lfValueOf(protocolReceiver) + _lfValueOf(body)
            + _lfValueOf(_account(master));
        for (uint _j; _j < lfN; ++_j) {
            _ends += _lfValueOf(lfAccts[_j]) + _lfValueOf(lfUsers[_j]);
        }
        if (lfOtherAcct != address(0)) {
            _ends += _lfValueOf(lfOtherAcct) + _lfValueOf(lfOtherBody) + _lfValueOf(lfOtherMaster)
                + _lfValueOf(_account(lfOtherMaster)) + _lfValueOf(lfOtherUser);
        }
        _lfEq(
            _ends,
            lfExo,
            "every wei the fund and its holders started with ends with a holder, the master's wallet, the fee receiver, the protocol receiver or the fund"
        );
    }

    function _lfValueOf(
        address _a
    ) internal view returns (uint) {
        return usdc.balanceOf(_a) * USD + wnt.balanceOf(_a) + _a.balance;
    }

    function _lfRun(
        uint _seed,
        uint _n,
        uint _steps,
        bool _extended
    ) internal {
        rng = _seed;
        _lfSetup(_n, _seed, _extended);
        _lfAllocate(true);
        _lfMarket(0);
        _lfAllocate(false);
        _lfMarket(1);
        _lfCheck();
        for (lfStep = 0; lfStep < _steps; ++lfStep) {
            uint _op = _rand() % 12;
            if (_op < 3) _lfAllocate(false);
            else if (_op < 5) _lfSell();
            else if (_op < 7) _lfOpen();
            else if (_op < 9) _lfCohort();
            else if (_op == 9) _lfRemandate();
            else _lfMarket(_rand() % 6);
            _lfCheck();
        }
        _lfEnd();
    }

    function testFuzz_value_is_conserved_and_paid_at_one_price(
        uint _seed,
        uint8 _n
    ) public {
        _lfRun(_seed, 3 + uint(_n) % (NMAX - 2), 40, false);
    }

    function testFuzz_value_is_conserved_over_long_fund_lives(
        uint _seed,
        uint8 _n
    ) public {
        _lfRun(_seed, 3 + uint(_n) % (NMAX - 2), 150, false);
    }

    function testFuzz_value_is_conserved_beside_another_fund_in_the_shared_store(
        uint _seed,
        uint8 _n
    ) public {
        _lfRun(_seed, 3 + uint(_n) % (NMAX - 2), 60, true);
    }

    function _dfList(
        uint _mask
    ) internal view returns (address[] memory list_) {
        uint _count;
        for (uint _k; _k < DFN; ++_k) {
            if ((_mask >> _k) & 1 == 1) ++_count;
        }
        list_ = new address[](_count);
        uint _n;
        for (uint _k; _k < DFN; ++_k) {
            if ((_mask >> _k) & 1 == 1) list_[_n++] = dfAccts[_k];
        }
    }

    function _dfPrice(
        uint _bps
    ) internal {
        _toWethAll();
        uint _target = Math.mulDiv(shareToken.totalSupply() + VIRTUAL_SHARES, _bps, 1e4) - VIRTUAL_VALUE;
        uint _cash = wnt.balanceOf(body);
        if (_target > _cash) {
            _wethTo(body, _target - _cash);
        } else if (_target < _cash) {
            vm.prank(body);
            wnt.transfer(SINK, _cash - _target);
        }
    }

    function _dfEnter(
        uint _mask
    ) internal {
        address[] memory _list = _dfList(_mask);
        uint _len = _list.length;
        Fund.Allocation[] memory _rows = new Fund.Allocation[](_len);
        for (uint _n; _n < _len; ++_n) {
            uint _k = _n;
            while (_k > 0 && uint160(_rows[_k - 1].puppet) > uint160(_list[_n])) {
                _rows[_k] = _rows[_k - 1];
                --_k;
            }
            _rows[_k] = _row(_list[_n], dfTerms, 200e6 + _rand() % 1800e6);
        }
        uint[] memory _held = new uint[](_len);
        for (uint _n; _n < _len; ++_n) {
            _held[_n] = shareToken.balanceOf(_rows[_n].puppet);
        }
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(_nonceOf(body), _bodyValue() / USD, _rows);
        hub.allocate(_i, _sig, _ownerCoSig(_i));
        for (uint _n; _n < _len; ++_n) {
            address _acct = _rows[_n].puppet;
            uint _k;
            while (dfAccts[_k] != _acct) ++_k;
            uint _shares = shareToken.balanceOf(_acct);
            assertGt(_shares, _held[_n], "every row of the round mints");
            dfBasis[_k] += (_rows[_n].amount * USD - BILLED / _len) * BASIS;
            ++dfEntries[_k];
            assertApproxEqAbs(
                fundStore.getHolding(body, _acct).cost,
                Math.mulDiv(dfBasis[_k], PRICE_PRECISION, _shares * BASIS),
                dfEntries[_k] + 1,
                "the stored cost is the average price the holder paid for the shares it holds"
            );
        }
    }

    function _dfExit(
        uint _fraction,
        uint _join,
        uint _first,
        uint _seller
    ) internal returns (uint[DFN] memory fee_) {
        _toWethAll();
        DfExit memory _x;
        uint _supply = shareToken.totalSupply();
        uint _masterShares = shareToken.balanceOf(body);
        bool _full = _fraction == 10_000;
        _x.nav = _full ? wnt.balanceOf(body) : _bodyValue() + VIRTUAL_VALUE;
        _x.base = _full ? _supply : _supply + VIRTUAL_SHARES;
        _x.masterValue =
            Math.mulDiv(_fraction > 0 ? Math.mulDiv(_masterShares, _fraction, 1e4) : _join, _x.nav, _x.base);
        for (uint _k; _k < DFN; ++_k) {
            address _acct = dfAccts[_k];
            uint _queued = fundStore.getHolding(body, _acct).queued;
            _x.shares[_k] = shareToken.balanceOf(_acct);
            _x.claim[_k] = _queued * 1e4 + (_x.shares[_k] - _queued) * _fraction;
            _x.weth[_k] = wnt.balanceOf(_acct);
        }
        _x.owner = wnt.balanceOf(master);
        _x.fees = wnt.balanceOf(feeReceiver);
        _x.cuts = wnt.balanceOf(protocolReceiver);
        Fund.Valuation memory _v = _valuation(0);
        _v.assetList[0].value = _bodyValue();
        _redeem(_fraction, _join, _v, _dfList(_first));
        _x.price = fundStore.getRedemption(body).price;
        if (_seller < DFN) {
            uint _free = _x.shares[_seller] - fundStore.getHolding(body, dfAccts[_seller]).queued;
            _sell(dfUsers[_seller], dfKeys[_seller], (_free - _free * _fraction / 1e4) / 2 + 1);
        }
        hub.redeemCohort(shareToken, _dfList(2 ** DFN - 1));
        assertFalse(isOpen(fundStore.getRedemption(body)), "overlapping cohorts settle every holder and close the redemption");
        fee_ = _dfSettled(_x, _seller);
    }

    function _dfSettled(
        DfExit memory _x,
        uint _seller
    ) internal returns (uint[DFN] memory fee_) {
        uint _masterTotal = _x.masterValue;
        uint _relay;
        uint _cuts;
        uint _tolerance;
        for (uint _k; _k < DFN; ++_k) {
            address _acct = dfAccts[_k];
            if (_x.claim[_k] == 0) {
                assertEq(wnt.balanceOf(_acct), _x.weth[_k], "a holder with nothing to exit is paid nothing");
                continue;
            }
            uint _atPrice = Math.mulDiv(_x.claim[_k], _x.nav, _x.base * 1e4);
            uint _paid = Math.mulDiv(dfBasis[_k], _x.claim[_k], _x.shares[_k] * 1e4 * BASIS);
            fee_[_k] = _atPrice > _paid ? (_atPrice - _paid) * PERFORMANCE_FEE / 1e4 : 0;
            uint _relayed = _k == _seller ? 0 : BILLED;
            uint _t = Math.mulDiv(_atPrice, dfEntries[_k] + 2, _x.price) + 2 * DFN + 4;
            assertApproxEqAbs(
                wnt.balanceOf(_acct) - _x.weth[_k],
                _atPrice - fee_[_k] - _relayed,
                _t,
                "each holder receives its claim at the exit price less the fee on its own gain over its entries"
            );
            uint _cut = fee_[_k] * PROTOCOL_FEE_SHARE / 1e4;
            _masterTotal += fee_[_k] - _cut;
            _cuts += _cut;
            _relay += _relayed;
            _tolerance += _t;
            dfBasis[_k] -= Math.mulDiv(dfBasis[_k], _x.shares[_k] - shareToken.balanceOf(_acct), _x.shares[_k]);
        }
        uint _masterFee = Math.min(_masterTotal, BILLED);
        assertApproxEqAbs(
            wnt.balanceOf(master) - _x.owner,
            _masterTotal - _masterFee,
            _tolerance + 2,
            "the master's wallet collects its own exit beside every holder's fee net of the protocol cut"
        );
        assertApproxEqAbs(
            wnt.balanceOf(feeReceiver) - _x.fees,
            _relay + _masterFee,
            _tolerance / 10 + 2 * DFN + 4,
            "the fee receiver collects the relay fees alone"
        );
        assertApproxEqAbs(
            wnt.balanceOf(protocolReceiver) - _x.cuts,
            _cuts,
            _tolerance / 10 + 2 * DFN + 4,
            "and the protocol receiver the protocol's cut of every fee"
        );
    }

    function testFuzz_each_holder_pays_the_fee_on_its_own_gain_and_nothing_on_a_loss(
        uint _seed
    ) public {
        rng = _seed;
        _openFund("DF");
        dfTerms = _terms(MAX_SKIN);
        for (uint _k; _k < DFN; ++_k) {
            (dfUsers[_k], dfKeys[_k]) = makeAddrAndKey(string.concat("df-", vm.toString(_k)));
            dfAccts[_k] = _account(dfUsers[_k]);
            _fundWallet(dfUsers[_k], 50_000e6);
            _signMandate(dfUsers[_k], dfKeys[_k], dfTerms);
        }
        _dfEnter(7);
        uint _peak = 12_000 + _rand() % 8000;
        _dfPrice(_peak);
        _dfEnter(9);
        _dfExit(2000 + _rand() % 6000, 0, 1 + _rand() % 15, DFN);
        _dfPrice(5000 + _rand() % 4500);
        _dfEnter(6);
        _dfPrice(10_500 + _rand() % (_peak * 95 / 100 - 10_500));
        _sell(dfUsers[3], dfKeys[3], shareToken.balanceOf(dfAccts[3]) / 3);
        _signMandate(dfUsers[3], dfKeys[3], dfTerms);
        _dfEnter(8);
        uint _first = 1 + _rand() % 7;
        uint[DFN] memory _fee = _dfExit(2000 + _rand() % 6000, 0, (_first & 1) | (_first & 6) << 1, 1);
        assertGt(_fee[1], 0, "a holder whose entries average below the exit price pays a fee, also when it sells into the open");
        assertGt(_fee[2], 0, "as does every such holder");
        assertEq(_fee[3], 0, "the holder who entered at the peak exits at a loss and pays nothing");
        assertGe(
            fundStore.getHolding(body, dfAccts[3]).cost,
            fundStore.getRedemption(body).price,
            "because its cost, blended over its queued shares too, sits above the exit price"
        );
        uint _queued = fundStore.getRedemption(body).queued;
        uint _master = shareToken.balanceOf(body);
        uint _cap = Math.mulDiv(_master, _queued, shareToken.totalSupply() - _master);
        _dfExit(0, _rand() % (_cap + 1), 2, DFN);
        _dfPrice(8000 + _rand() % 6000);
        _dfExit(10_000, 0, 1 + _rand() % 15, DFN);
        assertEq(shareToken.totalSupply(), 0, "the master's close retires every share");
        assertEq(wnt.balanceOf(body), 0, "and pays out the whole fund");
        assertEq(wnt.balanceOf(address(fundStore)), 0, "leaving nothing in the store");
    }
}
