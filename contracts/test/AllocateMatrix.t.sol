// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {LibClone} from "solady/utils/LibClone.sol";

import {HubGate, MANDATE_INTENT_TYPEHASH} from "src/HubGate.sol";
import {Fund, VIRTUAL_UNITS, VIRTUAL_VALUE} from "src/core/Fund.sol";
import {FundStore} from "src/core/FundStore.sol";
import {Share} from "src/core/Share.sol";
import {UserAccount} from "src/core/UserAccount.sol";
import {AccountLib} from "src/utils/AccountLib.sol";
import {Error} from "src/utils/Error.sol";
import {LiquidityGate} from "src/utils/LiquidityGate.sol";
import {NATIVE_TOKEN} from "src/utils/Native.sol";

import {HotPathTest} from "./HotPath.t.sol";
import {MockERC20} from "./mock/MockERC20.t.sol";

contract AllocateMatrixTest is HotPathTest {
    uint constant FEE_VALUE = FEE * USD;
    uint constant SEED = 500e6;

    struct Book {
        uint[6] held;
        uint body;
        uint fee;
        uint supply;
        uint nav;
        uint masterUnits;
        uint totalSupply;
        uint nonce;
    }

    function _usdcPrice() internal view returns (Fund.Price memory) {
        return Fund.Price({token: address(usdc), amount: 1e6, value: 1e6 * USD});
    }

    function _noCredit() internal pure returns (Fund.Credit memory) {
        return Fund.Credit({chainId: 0, token: address(0), amount: 0});
    }

    function _round(
        Fund.Price memory _price,
        Fund.Credit memory _c,
        Fund.Allocation[] memory _rows
    ) internal view returns (Fund.AllocateIntent memory intent_, bytes memory coSig_) {
        intent_ = Fund.AllocateIntent({
            header: AccountLib.IntentHeader({
                account: body,
                user: master,
                nonce: _nonceOf(body),
                deadline: vm.getBlockTimestamp() + 300,
                feeToken: address(0),
                fee: FEE_VALUE
            }),
            share: share,
            valuation: _valuation(usdc.balanceOf(body)),
            price: _price,
            credit: _c,
            allocationList: _rows
        });
        coSig_ = _pair(masterKey, _allocateDigest(intent_));
    }

    function _openFund() internal {
        _fundWallet(master, 2000e6);
        bytes32 _symbol = bytes32("AM");
        bytes memory _pixels = new bytes(154);
        share = Share(
            LibClone.predictDeterministicAddress(
                fundModule.shareImpl(),
                abi.encodePacked(_symbol, _pixels, uint16(hub.performanceFee())),
                bytes32(uint(uint160(body))),
                address(hub)
            )
        );
        _escrow(LiquidityGate(address(hub)), address(usdc), SEED);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _round(_usdcPrice(), _credit(block.chainid, address(usdc), SEED), new Fund.Allocation[](0));
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), body, _account(master));
        hub.createFund(_symbol, _pixels, _coSig(bodyKey, _genesis), _coSig(masterKey, _genesis), _i, _sig);
        assertEq(share.balanceOf(body), 499e18, "the opening credit mints the seed net of the round fee");
        assertEq(usdc.balanceOf(body), SEED - FEE, "and lands it in the body net of that fee");
    }

    function _mandateOf(
        uint _skin,
        uint _cooldown,
        uint _expiry
    ) internal view returns (AccountLib.Mandate memory) {
        return AccountLib.Mandate({
            master: body, skin: _skin, allocationRate: 5000, cooldownPeriod: _cooldown, expiry: _expiry
        });
    }

    function _list(
        AccountLib.Mandate memory _m
    ) internal pure returns (AccountLib.Mandate[] memory list_) {
        list_ = new AccountLib.Mandate[](1);
        list_[0] = _m;
    }

    function _tokens(
        address _token
    ) internal pure returns (address[] memory list_) {
        list_ = new address[](1);
        list_[0] = _token;
    }

    function _one(
        address _puppet,
        AccountLib.Mandate memory _m,
        uint _amount
    ) internal pure returns (Fund.Allocation[] memory rows_) {
        rows_ = new Fund.Allocation[](1);
        rows_[0] = Fund.Allocation({puppet: _puppet, mandate: _m, amount: _amount});
    }

    function _mandateIntent(
        address _user,
        uint _key,
        AccountLib.Mandate[] memory _mandates,
        address[] memory _tokenList,
        bool _arm
    ) internal returns (HubGate.MandateIntent memory intent_, bytes memory coSig_) {
        address _acct = _account(_user);
        bytes[] memory _sigs = new bytes[](_mandates.length);
        for (uint _j; _j < _mandates.length; ++_j) {
            _sigs[_j] = _coSig(_key, this.digestOf(_acct, _mandates[_j]));
        }
        intent_ = HubGate.MandateIntent({
            header: AccountLib.IntentHeader({
                account: _acct,
                user: _user,
                nonce: _nonceOf(_acct),
                deadline: vm.getBlockTimestamp() + 300,
                feeToken: address(usdc),
                fee: FEE
            }),
            mandateList: _mandates,
            signatureList: _sigs,
            tokenList: _tokenList,
            arm: _arm
        });
        coSig_ = _pair(
            _key,
            _typed(
                _acct,
                keccak256(
                    abi.encode(
                        MANDATE_INTENT_TYPEHASH,
                        _hashHeader(intent_.header),
                        keccak256(abi.encode(_mandates)),
                        keccak256(abi.encodePacked(_tokenList)),
                        _arm
                    )
                )
            )
        );
    }

    function _mandateCall(
        address _user,
        uint _key,
        AccountLib.Mandate[] memory _mandates,
        address[] memory _tokenList,
        bool _arm
    ) internal {
        (HubGate.MandateIntent memory _i, bytes memory _sig) = _mandateIntent(_user, _key, _mandates, _tokenList, _arm);
        hub.mandate(_i, _sig);
    }

    function _backer(
        string memory _tag,
        AccountLib.Mandate memory _m
    ) internal returns (address acct_, uint key_, address user_) {
        (user_, key_) = makeAddrAndKey(_tag);
        _fundWallet(user_, 1000e6);
        _mandateCall(user_, key_, _list(_m), _tokens(address(usdc)), true);
        acct_ = _account(user_);
    }

    function _cohort(
        string memory _tag,
        uint _n
    ) internal returns (address[] memory users_, uint[] memory keys_) {
        users_ = new address[](_n);
        keys_ = new uint[](_n);
        for (uint _j; _j < _n; ++_j) {
            (address _u, uint _k) = makeAddrAndKey(string.concat(_tag, vm.toString(_j)));
            uint _at = _j;
            while (
                _at > 0 && accountModule.predictUserAccount(users_[_at - 1]) > accountModule.predictUserAccount(_u)
            ) {
                users_[_at] = users_[_at - 1];
                keys_[_at] = keys_[_at - 1];
                --_at;
            }
            users_[_at] = _u;
            keys_[_at] = _k;
        }
    }

    function _matrixCast(
        uint _creditAmount
    ) internal returns (Fund.AllocateIntent memory intent_, bytes memory coSig_) {
        (address[] memory _users, uint[] memory _keys) = _cohort("matrix-", 6);
        uint[6] memory _amounts = [uint(1e6), 100e6, 100e6, 200e6, 100e6, 100e6];
        uint[6] memory _skins = [uint(5000), 1000, 5000, 0, 5000, 5000];
        Fund.Allocation[] memory _rows = new Fund.Allocation[](6);
        for (uint _j; _j < 6; ++_j) {
            _fundWallet(_users[_j], 1000e6);
            AccountLib.Mandate memory _m = _mandateOf(_skins[_j], 0, vm.getBlockTimestamp() + 365 days);
            _mandateCall(_users[_j], _keys[_j], _list(_m), _tokens(address(usdc)), true);
            _rows[_j] = Fund.Allocation({puppet: _account(_users[_j]), mandate: _m, amount: _amounts[_j]});
        }
        _mandateCall(_users[2], _keys[2], new AccountLib.Mandate[](0), _tokens(address(usdc)), false);
        vm.prank(_users[5]);
        UserAccount(payable(_rows[5].puppet)).requestWithdraw();
        if (_creditAmount > 0) _escrow(LiquidityGate(address(hub)), address(usdc), _creditAmount);

        (intent_, coSig_) = _round(
            _usdcPrice(),
            _creditAmount > 0 ? _credit(block.chainid, address(usdc), _creditAmount) : _noCredit(),
            _rows
        );

        _mandateCall(_users[4], _keys[4], _list(_mandateOf(5000, 0, vm.getBlockTimestamp())), new address[](0), true);

        assertEq(
            IERC20(address(usdc)).allowance(_rows[2].puppet, address(fundModule)), 0, "B disarmed its allowance"
        );
        assertEq(
            mandateStore.mandateMap(_rows[2].puppet, body),
            this.digestOf(_rows[2].puppet, _rows[2].mandate),
            "B's mandate still stands, so only the transfer can skip it"
        );
        assertEq(mandateStore.mandateMap(_rows[4].puppet, body), bytes32(0), "C revoked after the round was signed");
        assertEq(
            IERC20(address(usdc)).allowance(_rows[4].puppet, address(fundModule)),
            type(uint).max,
            "C stays armed, so only the mandate can skip it"
        );
        assertGt(UserAccount(payable(_rows[5].puppet)).withdrawRequestedAt(), 0, "D holds an open withdraw request");
    }

    function _matrix(
        uint _creditAmount,
        uint _feeDelta,
        uint _unitsE,
        uint _unitsF,
        uint _unitsMaster
    ) internal {
        _openFund();
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _matrixCast(_creditAmount);
        Fund.Allocation[] memory _rows = _i.allocationList;

        Book memory _b;
        for (uint _j; _j < 6; ++_j) {
            _b.held[_j] = usdc.balanceOf(_rows[_j].puppet);
        }
        _b.body = usdc.balanceOf(body);
        _b.fee = usdc.balanceOf(feeReceiver);
        _b.supply = share.totalSupply() + VIRTUAL_UNITS;
        _b.nav = _i.valuation.value + VIRTUAL_VALUE;
        _b.masterUnits = share.balanceOf(body);
        _b.totalSupply = share.totalSupply();
        _b.nonce = _nonceOf(body);

        hub.allocate(_i, _sig);

        uint _masterLeg = _creditAmount > 0 ? 1 : 0;
        uint _slice = FEE_VALUE / (6 + _masterLeg);
        uint _billed = Math.mulDiv(2 * _slice, 1e6, 1e6 * USD);
        uint _masterBilled = _masterLeg > 0 ? Math.mulDiv(_slice, 1e6, 1e6 * USD, Math.Rounding.Ceil) : 0;

        uint[4] memory _skipped = [uint(0), 2, 4, 5];
        for (uint _j; _j < 4; ++_j) {
            address _p = _rows[_skipped[_j]].puppet;
            assertEq(usdc.balanceOf(_p), _b.held[_skipped[_j]], "a skipped puppet keeps its balance");
            assertEq(share.balanceOf(_p), 0, "a skipped puppet is minted nothing");
            FundStore.Holding memory _h = fundStore.getHolding(body, _p);
            assertEq(_h.basis, 0, "a skipped row books no basis");
            assertEq(_h.allocatedAt, 0, "and starts no cooldown");
        }

        assertEq(Math.mulDiv(100e6 * USD - _slice, _b.supply, _b.nav), _unitsE, "E's units follow the fixed slice");
        assertEq(Math.mulDiv(200e6 * USD - _slice, _b.supply, _b.nav), _unitsF, "F's units follow the same slice");
        assertEq(share.balanceOf(_rows[1].puppet), _unitsE, "E is minted (value - slice) * supply / nav");
        assertEq(share.balanceOf(_rows[3].puppet), _unitsF, "F is minted (value - slice) * supply / nav");
        assertEq(usdc.balanceOf(_rows[1].puppet), _b.held[1] - 100e6, "E pays exactly its row");
        assertEq(usdc.balanceOf(_rows[3].puppet), _b.held[3] - 200e6, "F pays exactly its row");
        assertEq(fundStore.getHolding(body, _rows[1].puppet).basis, 100e6 * USD, "E's basis is its full value");
        assertEq(fundStore.getHolding(body, _rows[3].puppet).basis, 200e6 * USD, "F's basis is its full value");
        assertEq(fundStore.getHolding(body, _rows[3].puppet).allocatedAt, vm.getBlockTimestamp(), "F's cooldown starts");

        assertEq(
            _masterLeg > 0 ? Math.mulDiv(_creditAmount * USD - _slice, _b.supply, _b.nav) : 0,
            _unitsMaster,
            "the master leg mints on value net of the same slice"
        );
        assertEq(share.balanceOf(body) - _b.masterUnits, _unitsMaster, "pinned master units");
        assertEq(share.totalSupply() - _b.totalSupply, _unitsE + _unitsF + _unitsMaster, "supply grows by exactly the minted units");

        assertEq(usdc.balanceOf(feeReceiver) - _b.fee, _billed + _masterBilled, "fee receiver gets the row billing plus the master billing");
        assertEq(usdc.balanceOf(feeReceiver) - _b.fee, _feeDelta, "pinned fee receiver delta");
        assertEq(
            usdc.balanceOf(body),
            _b.body + 300e6 + _creditAmount - _billed - _masterBilled,
            "body receives the included rows plus the credit minus everything billed"
        );
        assertEq(fundStore.skinMap(body), 1000, "only included rows raise the floor");
        assertEq(_nonceOf(body), _b.nonce + 1, "the round consumes one body nonce");
        if (_masterLeg > 0) {
            assertEq(
                escrowStore.fulfilledMap(_account(master), body, address(usdc)),
                SEED + _creditAmount,
                "the local credit is fulfilled from escrow"
            );
            assertEq(usdc.balanceOf(address(escrowStore)), 0, "escrow releases exactly the credit");
        }
    }

    function test_matrix_without_credit_skips_four_and_the_relayer_absorbs_their_slices() public {
        _matrix(0, 333_333, 99_833_333_333_333_333_333, 199_833_333_333_333_333_333, 0);
    }

    function test_matrix_with_local_credit_bills_the_master_one_fixed_slice() public {
        _matrix(
            100e6, 428_572, 99_857_142_857_142_857_142, 199_857_142_857_142_857_142, 99_857_142_857_142_857_142
        );
    }

    function test_relay_fee_cap_skips_at_exactly_max_bps_and_includes_one_wei_above() public {
        _openFund();
        AccountLib.Mandate memory _m = _mandateOf(0, 0, vm.getBlockTimestamp() + 365 days);
        (address _p,,) = _backer("fee-cap", _m);

        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_p, _m, 10e6));
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig);

        uint _held = usdc.balanceOf(_p);
        uint _supply = share.totalSupply() + VIRTUAL_UNITS;
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_p, _m, 10e6 + 1));
        uint _nav = _i.valuation.value + VIRTUAL_VALUE;
        uint _feeBefore = usdc.balanceOf(feeReceiver);
        hub.allocate(_i, _sig);
        assertEq(share.balanceOf(_p), Math.mulDiv((10e6 + 1) * USD - FEE_VALUE, _supply, _nav), "one wei above the cap is included");
        assertEq(share.balanceOf(_p), 9_000_001e12, "and carries the whole fee as the only row");
        assertEq(usdc.balanceOf(_p), _held - 10e6 - 1, "the puppet pays its row");
        assertEq(usdc.balanceOf(feeReceiver) - _feeBefore, FEE, "the lone row bills the whole fee");
    }

    function test_credit_must_cover_its_own_slice_whatever_the_rows_do() public {
        _openFund();
        _escrow(LiquidityGate(address(hub)), address(usdc), 20e6);
        uint _t0 = vm.getBlockTimestamp();
        AccountLib.Mandate memory _good = _mandateOf(0, 0, _t0 + 365 days);
        AccountLib.Mandate memory _expiring = _mandateOf(0, 0, _t0 + 1);
        (address _q,,) = _backer("credit-good", _good);
        (address _p,,) = _backer("credit-expiring", _expiring);

        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _round(_usdcPrice(), _credit(block.chainid, address(usdc), 1e6), new Fund.Allocation[](0));
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__FeeUnfunded.selector, FEE, FEE));
        hub.allocate(_i, _sig);

        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 0.5e6), _one(_q, _good, 100e6));
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__FeeUnfunded.selector, FEE / 2, FEE / 2));
        hub.allocate(_i, _sig);

        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 0.5e6 + 1), _one(_p, _expiring, 100e6));
        uint _supply = share.totalSupply() + VIRTUAL_UNITS;
        uint _nav = _i.valuation.value + VIRTUAL_VALUE;
        uint _bodyBefore = usdc.balanceOf(body);
        uint _feeBefore = usdc.balanceOf(feeReceiver);
        uint _unitsBefore = share.balanceOf(body);
        uint _held = usdc.balanceOf(_p);
        vm.warp(_t0 + 1);
        hub.allocate(_i, _sig);
        assertEq(usdc.balanceOf(_p), _held, "a mandate that expired after signing skips its row");
        assertEq(share.balanceOf(_p), 0, "and mints nothing for it");
        assertEq(usdc.balanceOf(feeReceiver) - _feeBefore, FEE / 2, "the master leg pays only its own slice");
        assertEq(usdc.balanceOf(body) - _bodyBefore, 1, "the body keeps the credit net of that slice");
        assertEq(share.balanceOf(body) - _unitsBefore, Math.mulDiv(USD, _supply, _nav), "the master mints on the one wei above its slice");
        assertEq(share.balanceOf(body) - _unitsBefore, 1e12, "pinned master units");
    }

    function test_all_rows_skipped_without_credit_reverts_zero_amount() public {
        _openFund();
        (address[] memory _users, uint[] memory _keys) = _cohort("all-skip-", 2);
        AccountLib.Mandate memory _m = _mandateOf(0, 0, vm.getBlockTimestamp() + 365 days);
        Fund.Allocation[] memory _rows = new Fund.Allocation[](2);
        for (uint _j; _j < 2; ++_j) {
            _fundWallet(_users[_j], 1000e6);
            _mandateCall(_users[_j], _keys[_j], _list(_m), _tokens(address(usdc)), true);
            _rows[_j] = Fund.Allocation({puppet: _account(_users[_j]), mandate: _m, amount: _j == 0 ? 1e6 : 100e6});
        }
        _mandateCall(_users[1], _keys[1], new AccountLib.Mandate[](0), _tokens(address(usdc)), false);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig);
    }

    function test_cooldown_reverts_with_exact_args_until_the_period_elapses() public {
        _openFund();
        AccountLib.Mandate memory _m = _mandateOf(0, 1 days, vm.getBlockTimestamp() + 365 days);
        (address _p,,) = _backer("cooldown", _m);
        Fund.Allocation[] memory _rows = _one(_p, _m, 20e6);

        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        hub.allocate(_i, _sig);
        uint _t0 = vm.getBlockTimestamp();
        assertEq(fundStore.getHolding(body, _p).allocatedAt, _t0, "the first round starts the cooldown");

        vm.warp(_t0 + 1 days - 1);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        vm.expectRevert(abi.encodeWithSelector(Error.Mandate__Cooldown.selector, _p, _t0, 1 days));
        hub.allocate(_i, _sig);

        vm.warp(_t0 + 1 days);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        hub.allocate(_i, _sig);
        FundStore.Holding memory _h = fundStore.getHolding(body, _p);
        assertEq(_h.allocatedAt, _t0 + 1 days, "the round at the period boundary lands and restarts the cooldown");
        assertEq(_h.basis, 40e6 * USD, "and adds its value to the basis");
    }

    function test_cooldown_near_max_reverts_typed_and_orders_between_fee_skip_and_transfer_skip() public {
        _openFund();
        AccountLib.Mandate memory _m = _mandateOf(0, type(uint).max, type(uint).max);
        (address _p, uint _key, address _user) = _backer("cooldown-max", _m);

        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_p, _m, 20e6));
        hub.allocate(_i, _sig);
        uint _t0 = vm.getBlockTimestamp();
        _escrow(LiquidityGate(address(hub)), address(usdc), 50e6);

        vm.warp(_t0 + 36_500 days);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_p, _m, 20e6));
        vm.expectRevert(abi.encodeWithSelector(Error.Mandate__Cooldown.selector, _p, _t0, type(uint).max));
        hub.allocate(_i, _sig);

        _mandateCall(_user, _key, new AccountLib.Mandate[](0), _tokens(address(usdc)), false);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_p, _m, 20e6));
        vm.expectRevert(abi.encodeWithSelector(Error.Mandate__Cooldown.selector, _p, _t0, type(uint).max));
        hub.allocate(_i, _sig);

        uint _unitsBefore = share.balanceOf(_p);
        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 50e6), _one(_p, _m, 1e6));
        hub.allocate(_i, _sig);
        assertEq(share.balanceOf(_p), _unitsBefore, "a row over the fee cap skips before its cooldown is read");
        assertEq(fundStore.getHolding(body, _p).allocatedAt, _t0, "and leaves the cooldown untouched");
    }

    function test_unsorted_or_duplicate_rows_revert_even_when_the_offender_would_skip() public {
        _openFund();
        (address[] memory _users, uint[] memory _keys) = _cohort("sorted-", 2);
        AccountLib.Mandate memory _m = _mandateOf(0, 0, vm.getBlockTimestamp() + 365 days);
        address[2] memory _acct;
        for (uint _j; _j < 2; ++_j) {
            _fundWallet(_users[_j], 1000e6);
            _mandateCall(_users[_j], _keys[_j], _list(_m), _tokens(address(usdc)), true);
            _acct[_j] = _account(_users[_j]);
        }
        Fund.Allocation[] memory _rows = new Fund.Allocation[](2);

        _rows[0] = Fund.Allocation({puppet: _acct[1], mandate: _m, amount: 100e6});
        _rows[1] = Fund.Allocation({puppet: _acct[0], mandate: _m, amount: 100e6});
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__AllocationListNotSorted.selector, _acct[1], _acct[0]));
        hub.allocate(_i, _sig);

        _rows[0] = Fund.Allocation({puppet: _acct[0], mandate: _m, amount: 100e6});
        _rows[1] = Fund.Allocation({puppet: _acct[0], mandate: _m, amount: 100e6});
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__AllocationListNotSorted.selector, _acct[0], _acct[0]));
        hub.allocate(_i, _sig);

        _rows[0] = Fund.Allocation({puppet: _acct[1], mandate: _m, amount: 1e6});
        _rows[1] = Fund.Allocation({puppet: _acct[0], mandate: _m, amount: 100e6});
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__AllocationListNotSorted.selector, _acct[1], _acct[0]));
        hub.allocate(_i, _sig);

        _rows[0] = Fund.Allocation({puppet: _acct[0], mandate: _m, amount: 100e6});
        _rows[1] = Fund.Allocation({puppet: _acct[1], mandate: _m, amount: 100e6});
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _rows);
        hub.allocate(_i, _sig);
        assertEq(share.balanceOf(_acct[0]), 99.5e18, "the sorted pair lands, each row carrying half the fee");
        assertEq(share.balanceOf(_acct[1]), 99.5e18, "the sorted pair lands, each row carrying half the fee");
    }

    function test_unregistered_or_deregistered_round_token_reverts() public {
        _openFund();
        MockERC20 _stray = new MockERC20("STRAY", "STRAY", 6);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(
            Fund.Price({token: address(_stray), amount: 1e6, value: 1e6 * USD}),
            _credit(block.chainid, address(_stray), 10e6),
            new Fund.Allocation[](0)
        );
        vm.expectRevert(abi.encodeWithSelector(Error.Intent__TokenNotValuable.selector, address(_stray)));
        hub.allocate(_i, _sig);

        _escrow(LiquidityGate(address(hub)), address(usdc), 10e6);
        (_i, _sig) = _round(_usdcPrice(), _credit(block.chainid, address(usdc), 10e6), new Fund.Allocation[](0));
        vm.startPrank(owner);
        dictate.setAccess(register, owner);
        register.setRegistered(address(usdc), bytes32(0));
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(Error.Intent__TokenNotValuable.selector, address(usdc)));
        hub.allocate(_i, _sig);

        vm.prank(owner);
        register.setRegistered(address(usdc), bytes32("USDC"));
        hub.allocate(_i, _sig);
        assertEq(
            escrowStore.fulfilledMap(_account(master), body, address(usdc)),
            SEED + 10e6,
            "registration is read when the round executes, so the same signed round lands once relisted"
        );
    }

    function test_native_round_refuses_backer_rows() public {
        _openFund();
        (address[] memory _users,) = _cohort("native-", 2);
        AccountLib.Mandate memory _m = _mandateOf(0, 0, vm.getBlockTimestamp() + 365 days);
        Fund.Allocation[] memory _rows = new Fund.Allocation[](2);
        for (uint _j; _j < 2; ++_j) {
            _rows[_j] = Fund.Allocation({puppet: _account(_users[_j]), mandate: _m, amount: 1 ether});
        }
        vm.deal(master, 1 ether);
        vm.prank(master);
        hub.depositEscrow{value: 1 ether}(body, NATIVE_TOKEN, 1 ether);
        Fund.Price memory _eth = Fund.Price({token: NATIVE_TOKEN, amount: 1 ether, value: 3000e6 * USD});
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _round(_eth, _credit(block.chainid, NATIVE_TOKEN, 1 ether), _rows);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__NativeRowsUnsupported.selector, 2));
        hub.allocate(_i, _sig);

        uint _unitsBefore = share.balanceOf(body);
        (_i, _sig) = _round(_eth, _credit(block.chainid, NATIVE_TOKEN, 1 ether), new Fund.Allocation[](0));
        hub.allocate(_i, _sig);
        assertEq(share.balanceOf(body) - _unitsBefore, 2999e18, "the same native credit without rows lands, so only rows are refused");
    }

    function test_local_credit_must_be_in_the_round_token_and_foreign_credit_moves_nothing_on_the_hub() public {
        _openFund();
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _round(_usdcPrice(), _credit(block.chainid, address(outToken), 100e6), new Fund.Allocation[](0));
        vm.expectRevert(
            abi.encodeWithSelector(Error.Fund__CreditTokenMismatch.selector, address(outToken), address(usdc))
        );
        hub.allocate(_i, _sig);

        uint _bodyBefore = usdc.balanceOf(body);
        uint _feeBefore = usdc.balanceOf(feeReceiver);
        uint _unitsBefore = share.balanceOf(body);
        (_i, _sig) = _round(_usdcPrice(), _credit(FOREIGN_CHAIN_ID, address(outToken), 100e6), new Fund.Allocation[](0));
        hub.allocate(_i, _sig);
        assertEq(fundStore.creditedMap(body, FOREIGN_CHAIN_ID, address(outToken)), 100e6, "a foreign credit is recorded under its own token");
        assertEq(share.balanceOf(body) - _unitsBefore, 99e18, "and mints the master on its value net of the signed fee");
        assertEq(usdc.balanceOf(body), _bodyBefore, "nothing moves on the hub for a foreign credit");
        assertEq(usdc.balanceOf(feeReceiver), _feeBefore, "and the hub bills nothing it cannot collect here");

        (_i, _sig) = _round(_usdcPrice(), _credit(FOREIGN_CHAIN_ID, address(outToken), 50e6), new Fund.Allocation[](0));
        hub.allocate(_i, _sig);
        assertEq(fundStore.creditedMap(body, FOREIGN_CHAIN_ID, address(outToken)), 150e6, "foreign credits accumulate");
    }

    function test_cohort_cap_refuses_fifty_one_rows_and_admits_fifty() public {
        _openFund();
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _dustRows(51));
        vm.expectRevert(abi.encodeWithSelector(Error.Gate__ListTooLong.selector, 51, 50));
        hub.allocate(_i, _sig);

        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _dustRows(50));
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig);
    }

    function _dustRows(
        uint _n
    ) internal view returns (Fund.Allocation[] memory rows_) {
        AccountLib.Mandate memory _m = _mandateOf(0, 0, vm.getBlockTimestamp() + 365 days);
        rows_ = new Fund.Allocation[](_n);
        for (uint _j; _j < _n; ++_j) {
            rows_[_j] = Fund.Allocation({puppet: address(uint160(0x1000 + _j)), mandate: _m, amount: 1});
        }
    }

    function test_mandate_skin_above_half_is_refused_at_mandate() public {
        (address _user, uint _key) = makeAddrAndKey("skin-cap");
        _fundWallet(_user, 10e6);
        address _acct = _account(_user);
        AccountLib.Mandate memory _m = _mandateOf(5001, 0, vm.getBlockTimestamp() + 365 days);
        (HubGate.MandateIntent memory _i, bytes memory _sig) =
            _mandateIntent(_user, _key, _list(_m), _tokens(address(usdc)), true);
        vm.expectRevert(abi.encodeWithSelector(Error.Mandate__InvalidSkin.selector, 5001));
        hub.mandate(_i, _sig);
        assertEq(mandateStore.mandateMap(_acct, body), bytes32(0), "nothing is stored for the refused skin");

        _m.skin = 5000;
        _mandateCall(_user, _key, _list(_m), _tokens(address(usdc)), true);
        assertEq(mandateStore.mandateMap(_acct, body), this.digestOf(_acct, _m), "symmetric skin is the ceiling");
    }

    function test_skin_floor_binds_while_backer_units_are_queued_and_resets_only_without_them() public {
        _openFund();
        AccountLib.Mandate memory _strict = _mandateOf(5000, 0, vm.getBlockTimestamp() + 365 days);
        (address _x, uint _xKey, address _xUser) = _backer("skin-strict", _strict);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _round(_usdcPrice(), _noCredit(), _one(_x, _strict, 400e6));
        hub.allocate(_i, _sig);
        assertEq(share.balanceOf(_x), 399e18, "the strict backer joins");
        assertEq(fundStore.skinMap(body), 5000, "and sets the floor");

        _sell(_xUser, _xKey, 399e18);
        assertEq(share.balanceOf(_x), 0, "the strict backer holds nothing");
        assertEq(share.balanceOf(address(fundStore)), 399e18, "its units wait in the queue");

        AccountLib.Mandate memory _lax = _mandateOf(0, 0, vm.getBlockTimestamp() + 365 days);
        (address _y,,) = _backer("skin-lax", _lax);
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_y, _lax, 200e6));
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__SkinBelowFloor.selector, 499e18, 1097e18, 5000));
        hub.allocate(_i, _sig);

        _redeem(0, 399e18);
        assertEq(share.totalSupply(), 499e18, "the queue drains and only master units remain");
        _redeem(100e18, 50e18);
        assertEq(fundStore.retiredMap(body), 50e18, "the master keeps retired units in the store");
        assertEq(share.balanceOf(body), 399e18, "and holds the rest");
        assertEq(fundStore.skinMap(body), 5000, "the stored floor is untouched by exits");

        uint _supply = share.totalSupply() + VIRTUAL_UNITS;
        (_i, _sig) = _round(_usdcPrice(), _noCredit(), _one(_y, _lax, 450e6));
        uint _nav = _i.valuation.value + VIRTUAL_VALUE;
        hub.allocate(_i, _sig);
        assertEq(share.balanceOf(_y), Math.mulDiv(449e6 * USD, _supply, _nav), "with no backer units the floor resets");
        assertEq(share.balanceOf(_y), 449e18, "pinned units, which a carried 5000 floor would refuse");
        assertEq(fundStore.skinMap(body), 0, "the reset floor is stored");
    }
}
