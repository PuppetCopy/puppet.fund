// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {LibClone} from "solady/utils/LibClone.sol";

import {HubGate, MANDATE_INTENT_TYPEHASH, PRICE_TYPEHASH, REDEEM_INTENT_TYPEHASH} from "src/HubGate.sol";
import {Fund} from "src/core/Fund.sol";
import {FundAccount} from "src/core/FundAccount.sol";
import {FundStore} from "src/core/FundStore.sol";
import {Share} from "src/core/Share.sol";
import {Error} from "src/utils/Error.sol";
import {AccountLib} from "src/utils/AccountLib.sol";
import {LiquidityGate} from "src/utils/LiquidityGate.sol";
import {NATIVE_TOKEN} from "src/utils/Native.sol";
import {HotPathTest} from "./HotPath.t.sol";

contract ScenariosTest is HotPathTest {
    uint constant SPOT = 3000;
    uint constant VU = 1e12;
    uint constant VV = 1e24;
    uint constant ACC = 1e48;
    uint constant NMAX = 6;
    uint constant OTHER_FUNDS = 1_000_000e6;
    address constant SINK = address(0x51AC);

    function _openFund(
        bytes32 _symbol
    ) internal {
        _fundWallet(master, 2000e6);
        bytes memory _pixels = new bytes(154);
        share = Share(
            LibClone.predictDeterministicAddress(
                fundModule.shareImpl(),
                abi.encodePacked(_symbol, _pixels, uint16(1000)),
                bytes32(uint(uint160(body))),
                address(hub)
            )
        );
        _escrow(LiquidityGate(address(hub)), address(usdc), 500e6);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(0, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), body, _account(master));
        hub.createFund(_symbol, _pixels, _coSig(bodyKey, _genesis), _coSig(masterKey, _genesis), _i, _sig);
    }

    function _terms(
        uint _skin
    ) internal view returns (AccountLib.Mandate memory) {
        return AccountLib.Mandate({
            master: body, skin: _skin, allocationRate: 5000, cooldownPeriod: 0, expiry: block.timestamp + 365 days
        });
    }

    function _mandateIntent(
        address _user,
        uint _key,
        AccountLib.Mandate memory _m,
        address[] memory _tokens,
        bool _arm
    ) internal view returns (HubGate.MandateIntent memory i_, bytes memory sig_) {
        address _acct = accountModule.predictUserAccount(_user);
        AccountLib.Mandate[] memory _list = new AccountLib.Mandate[](1);
        _list[0] = _m;
        bytes[] memory _sigs = new bytes[](1);
        _sigs[0] = _coSig(_key, this.digestOf(_acct, _m));
        i_ = HubGate.MandateIntent({
            header: _header(_acct, _user, _nonceOf(_acct)),
            mandateList: _list,
            signatureList: _sigs,
            tokenList: _tokens,
            arm: _arm
        });
        sig_ = _pair(
            _key,
            _typed(
                _acct,
                keccak256(
                    abi.encode(
                        MANDATE_INTENT_TYPEHASH,
                        _hashHeader(i_.header),
                        keccak256(abi.encode(_list)),
                        keccak256(abi.encodePacked(_tokens)),
                        _arm
                    )
                )
            )
        );
    }

    function _arm(
        address _user,
        uint _key,
        AccountLib.Mandate memory _m,
        address _token
    ) internal {
        address[] memory _tokens = new address[](1);
        _tokens[0] = _token;
        (HubGate.MandateIntent memory _i, bytes memory _sig) = _mandateIntent(_user, _key, _m, _tokens, true);
        hub.mandate(_i, _sig);
    }

    function _one(
        address _puppet,
        AccountLib.Mandate memory _m,
        uint _amount
    ) internal pure returns (Fund.Allocation[] memory rows_) {
        rows_ = new Fund.Allocation[](1);
        rows_[0] = Fund.Allocation({puppet: _puppet, mandate: _m, amount: _amount});
    }

    function _usd() internal view returns (Fund.Price memory) {
        return Fund.Price({token: address(usdc), amount: 1e6, value: 1e6 * USD});
    }

    function _spot(
        address _token
    ) internal pure returns (Fund.Price memory) {
        return Fund.Price({token: _token, amount: 1e18, value: SPOT * 1e6 * USD});
    }

    function _navUsdc() internal view returns (uint) {
        return usdc.balanceOf(body) + (outToken.balanceOf(body) + body.balance) * SPOT / 1e12;
    }

    function _balance(
        address _token,
        address _who
    ) internal view returns (uint) {
        return _token == NATIVE_TOKEN ? _who.balance : IERC20(_token).balanceOf(_who);
    }

    function _redeemIntent(
        uint _retire,
        uint _drain,
        Fund.Price memory _price,
        uint _nav,
        uint _fee
    ) internal view returns (Fund.RedeemIntent memory i_, bytes memory sig_) {
        AccountLib.IntentHeader memory _h = _fundHeader(_nonceOf(body));
        _h.fee = _fee;
        i_ = Fund.RedeemIntent({
            header: _h, share: share, valuation: _valuation(_nav), price: _price, retire: _retire, drain: _drain
        });
        sig_ = _pair(
            masterKey,
            _typed(
                body,
                keccak256(
                    abi.encode(
                        REDEEM_INTENT_TYPEHASH,
                        _hashHeader(_h),
                        share,
                        _valuationHash(i_.valuation),
                        keccak256(abi.encode(PRICE_TYPEHASH, _price.token, _price.amount, _price.value)),
                        _retire,
                        _drain
                    )
                )
            )
        );
    }

    function _redeemAt(
        uint _retire,
        uint _drain,
        Fund.Price memory _price
    ) internal {
        (Fund.RedeemIntent memory _i, bytes memory _sig) = _redeemIntent(_retire, _drain, _price, _navUsdc(), FEE * USD);
        hub.redeem(_i, _sig);
    }

    function _redeemReverts(
        uint _retire,
        uint _drain,
        bytes memory _err
    ) internal {
        (Fund.RedeemIntent memory _i, bytes memory _sig) = _redeemIntent(_retire, _drain, _usd(), _navUsdc(), FEE * USD);
        vm.expectRevert(_err);
        hub.redeem(_i, _sig);
    }

    function _claimSplit(
        address _holder,
        uint _basis
    ) internal returns (uint fee_) {
        FundStore.Position memory _p = fundStore.getPosition(body, _holder);
        assertEq(_p.basis, _basis, "the sell moved the holding basis into the exit position");
        assertEq(_p.shortfall, 0, "a first exit carries no shortfall");
        uint _payout = Math.mulDiv(_p.weight, fundStore.accruedMap(body, _p.epoch) - _p.cursor, ACC);
        fee_ = _payout > _basis ? (_payout - _basis) * 1000 / 10_000 : 0;
        address _owner = _account(master);
        address[] memory _tokens = fundStore.getEpochTokenList(body, _p.epoch);
        uint[] memory _gross = new uint[](_tokens.length);
        uint[] memory _held = new uint[](_tokens.length);
        uint[] memory _owned = new uint[](_tokens.length);
        for (uint _t; _t < _tokens.length; ++_t) {
            _gross[_t] = Math.mulDiv(
                _p.weight,
                fundStore.tokenAccruedMap(body, _p.epoch, _tokens[_t])
                    - fundStore.tokenCursorMap(body, _holder, _p.epoch, _tokens[_t]),
                ACC
            );
            _held[_t] = _balance(_tokens[_t], _holder);
            _owned[_t] = _balance(_tokens[_t], _owner);
        }
        hub.claim(body, share, _holder);
        for (uint _t; _t < _tokens.length; ++_t) {
            uint _fee = _payout == 0 ? 0 : Math.mulDiv(_gross[_t], fee_, _payout);
            assertGt(_gross[_t], 0, "every token the epoch paid in reaches the holder");
            assertEq(
                _balance(_tokens[_t], _holder) - _held[_t],
                _gross[_t] - _fee,
                "the holder gets its weight of the token, net of its fee slice"
            );
            assertEq(_balance(_tokens[_t], _owner) - _owned[_t], _fee, "the owner gets the fee slice in the same token");
        }
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__NothingToClaim.selector, _holder));
        hub.claim(body, share, _holder);
    }

    function test_opening_round_is_signed_at_body_nonce_zero() public {
        _fundWallet(master, 2000e6);
        bytes32 _symbol = bytes32("ZERO");
        bytes memory _pixels = new bytes(154);
        share = Share(
            LibClone.predictDeterministicAddress(
                fundModule.shareImpl(),
                abi.encodePacked(_symbol, _pixels, uint16(1000)),
                bytes32(uint(uint160(body))),
                address(hub)
            )
        );
        _escrow(LiquidityGate(address(hub)), address(usdc), 500e6);
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), body, _account(master));
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(1, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        vm.expectRevert(abi.encodeWithSelector(Error.Account__NonceMismatch.selector, body, 0, 1));
        hub.createFund(_symbol, _pixels, _coSig(bodyKey, _genesis), _coSig(masterKey, _genesis), _i, _sig);

        uint _feeBefore = usdc.balanceOf(feeReceiver);
        (_i, _sig) = _allocateIntent(0, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        hub.createFund(_symbol, _pixels, _coSig(bodyKey, _genesis), _coSig(masterKey, _genesis), _i, _sig);
        assertEq(FundAccount(payable(body)).nonce(), 1, "the opening round spends body nonce zero");
        assertEq(share.balanceOf(body), 499e18, "the escrow net of the round fee mints at one dollar a unit");
        assertEq(share.totalSupply(), 499e18, "the master holds the whole supply");
        assertEq(usdc.balanceOf(body), 499e6, "the escrow lands in the body net of the fee");
        assertEq(usdc.balanceOf(feeReceiver) - _feeBefore, FEE, "the fee is billed from the escrow store");
        assertEq(escrowStore.fulfilledMap(_account(master), body, address(usdc)), 500e6, "the escrow is consumed");
        assertEq(fundStore.skinMap(body), 0, "a round with no backers sets no floor");
    }

    function test_rounds_in_two_tokens_price_units_by_value_and_exits_split_by_weight() public {
        _openFund("MT");
        (address _a, uint _aKey) = makeAddrAndKey("rt-a");
        (address _b, uint _bKey) = makeAddrAndKey("rt-b");
        (address _c, uint _cKey) = makeAddrAndKey("rt-c");
        _fundWallet(_a, 1000e6);
        _fundWallet(_b, 10e6);
        _fundWallet(_c, 10e6);
        outToken.mint(_account(_b), 1e18);
        outToken.mint(_account(_c), 1e18);
        AccountLib.Mandate memory _m = _terms(0);
        _arm(_a, _aKey, _m, address(usdc));
        _arm(_b, _bKey, _m, address(outToken));
        _arm(_c, _cKey, _m, address(usdc));

        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(_nonceOf(body), _navUsdc(), _one(_account(_a), _m, 400e6));
        hub.allocate(_i, _sig);
        uint _unitsA = share.balanceOf(_account(_a));
        assertEq(_unitsA, 399e18, "a USDC row mints its value net of its relay slice at one dollar a unit");

        (_i, _sig) = _allocateIntent(
            _nonceOf(body),
            _navUsdc(),
            _spot(address(outToken)),
            _credit(block.chainid, address(usdc), 10e6),
            new Fund.Allocation[](0)
        );
        vm.expectRevert(
            abi.encodeWithSelector(Error.Fund__CreditTokenMismatch.selector, address(usdc), address(outToken))
        );
        hub.allocate(_i, _sig);

        uint _slice = FEE * USD / 2;
        uint _billed = Math.mulDiv(_slice, 1e18, SPOT * 1e6 * USD);
        uint _feeOut = outToken.balanceOf(feeReceiver);
        Fund.Allocation[] memory _rows = new Fund.Allocation[](2);
        (address _lo, uint _loAmount, address _hi, uint _hiAmount) = uint160(_account(_b)) < uint160(_account(_c))
            ? (_account(_b), 0.2e18, _account(_c), 0.1e18)
            : (_account(_c), 0.1e18, _account(_b), 0.2e18);
        _rows[0] = Fund.Allocation({puppet: _lo, mandate: _m, amount: _loAmount});
        _rows[1] = Fund.Allocation({puppet: _hi, mandate: _m, amount: _hiAmount});
        (_i, _sig) =
            _allocateIntent(_nonceOf(body), _navUsdc(), _spot(address(outToken)), _credit(0, address(0), 0), _rows);
        hub.allocate(_i, _sig);
        uint _unitsB = share.balanceOf(_account(_b));
        assertEq(_unitsB, (600e30 - _slice) / 1e12, "an OUT row mints at the round price, the same unit value as USDC");
        assertEq(share.balanceOf(_account(_c)), 0, "a backer who never armed the round token is skipped");
        assertEq(outToken.balanceOf(_account(_c)), 1e18, "and keeps its OUT");
        assertEq(outToken.balanceOf(feeReceiver) - _feeOut, _billed, "only the minted row's slice is billed, in OUT");
        assertEq(outToken.balanceOf(body), 0.2e18 - _billed, "the body keeps the OUT net of that slice");
        assertEq(fundStore.getHolding(body, _account(_b)).basis, 600e30, "the basis is the row's full value");

        _sell(_a, _aKey, _unitsA);
        _sell(_b, _bKey, _unitsB);
        uint _pool = _unitsA + _unitsB;
        assertEq(fundStore.getQueue(body).weight, _pool, "a first epoch weighs units one to one");
        usdc.mint(body, 300e6);
        address _owner = _account(master);
        uint _ownerUsdc = usdc.balanceOf(_owner);

        uint _drain = _pool * 6 / 10;
        uint _cvUsdc = Math.mulDiv(_drain, _navUsdc() * USD + VV, share.totalSupply() + VU);
        uint _parkedUsdc = _drainAt(1e18, _drain, _navUsdc());
        assertEq(fundStore.retiredMap(body), 1e18, "the master may retire while backers wait");
        assertEq(
            share.balanceOf(address(fundStore)),
            _pool - _drain + 1e18,
            "the drain came out of the backer pool and the retired units wait behind it"
        );
        assertEq(usdc.balanceOf(_owner), _ownerUsdc, "the owner is paid nothing while backers are queued");

        _redeemReverts(
            0,
            _pool - _drain + 1,
            abi.encodeWithSelector(Error.Fund__DrainExceedsQueue.selector, _pool - _drain + 1, _pool - _drain)
        );

        uint _cvOut = Math.mulDiv(_pool - _drain, _navUsdc() * USD + VV, share.totalSupply() + VU);
        uint _cashOut = Math.mulDiv(_cvOut, 1e18, SPOT * 1e6 * USD);
        uint _relayOut = Math.mulDiv(FEE * USD, 1e18, SPOT * 1e6 * USD, Math.Rounding.Ceil);
        uint[3] memory _outBefore = [
            outToken.balanceOf(body), outToken.balanceOf(address(fundStore)), outToken.balanceOf(feeReceiver)
        ];
        _redeemAt(0, _pool - _drain, _spot(address(outToken)));
        assertGe(_cvOut, 10 * FEE * USD, "the OUT drain moves at least ten relay fees");
        assertEq(_outBefore[0] - outToken.balanceOf(body), _cashOut, "the OUT drain moves the drained units' value in OUT");
        assertEq(outToken.balanceOf(feeReceiver) - _outBefore[2], _relayOut, "and bills the signed relay fee in OUT");
        assertEq(
            outToken.balanceOf(address(fundStore)) - _outBefore[1],
            _cashOut - _relayOut,
            "and parks the rest for the pool"
        );
        assertEq(share.balanceOf(address(fundStore)), 1e18, "both drains emptied the backer pool");
        assertEq(fundStore.getQueue(body).epoch, 1, "emptying the pool closes the epoch");
        assertEq(fundStore.getQueue(body).weight, 0, "and the next epoch starts weightless");
        address[] memory _paid = fundStore.getEpochTokenList(body, 0);
        assertEq(_paid.length, 2, "the epoch paid in two tokens");
        assertEq(_paid[0], address(usdc), "USDC first");
        assertEq(_paid[1], address(outToken), "then OUT");
        assertEq(
            fundStore.accruedMap(body, 0),
            Math.mulDiv(_cvUsdc - FEE * USD, ACC, _pool) + Math.mulDiv(_cvOut - FEE * USD, ACC, _pool),
            "each drain accrues its value net of the relay fee per unit of weight"
        );
        assertEq(
            fundStore.tokenAccruedMap(body, 0, address(usdc)),
            Math.mulDiv(_parkedUsdc, ACC, _pool),
            "the USDC accrual is what the USDC drain parked"
        );
        assertEq(
            fundStore.tokenAccruedMap(body, 0, address(outToken)),
            Math.mulDiv(_cashOut - _relayOut, ACC, _pool),
            "the OUT accrual is what the OUT drain parked"
        );

        assertGt(_claimSplit(_account(_a), 400e30), 0, "a USDC backer pays the performance fee on its gain");
        assertGt(_claimSplit(_account(_b), 600e30), 0, "an OUT backer pays it on the same terms");

        uint _outLeft = outToken.balanceOf(body);
        vm.prank(body);
        outToken.transfer(SINK, _outLeft);
        usdc.mint(body, _outLeft * SPOT / 1e12);
        uint _masterUnits = share.balanceOf(body);
        assertEq(_masterUnits, 498e18, "the retired unit left the master's balance");
        uint _cashValue = Math.mulDiv(_masterUnits + 1e18, _navUsdc() * USD + VV, share.totalSupply() + VU);
        _ownerUsdc = usdc.balanceOf(_owner);
        _redeemAt(_masterUnits, _masterUnits + 1e18, _usd());
        assertEq(share.totalSupply(), 0, "with every backer paid out, the master may leave entirely");
        assertEq(fundStore.retiredMap(body), 0, "every retired unit drained");
        assertEq(
            usdc.balanceOf(_owner) - _ownerUsdc,
            _cashValue / 1e24 - FEE,
            "the owner is paid the retired cash net of the relay fee"
        );
    }

    function test_skin_law_counts_queued_backers_ranks_retirement_behind_them_and_lifts_when_they_leave() public {
        _openFund("SK");
        address _owner = _account(master);
        (address _a, uint _aKey) = makeAddrAndKey("sk-a");
        _fundWallet(_a, 1000e6);
        address _acctA = _account(_a);
        AccountLib.Mandate memory _strict = _terms(5000);
        _arm(_a, _aKey, _strict, address(usdc));
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _one(_acctA, _strict, 400e6));
        hub.allocate(_i, _sig);
        assertEq(share.balanceOf(_acctA), 399e18, "the strict backer is minted");
        assertEq(fundStore.skinMap(body), 5000, "its mandate sets the floor");

        _sell(_a, _aKey, 100e18);

        (address _b, uint _bKey) = makeAddrAndKey("sk-b");
        _fundWallet(_b, 1000e6);
        AccountLib.Mandate memory _lax = _terms(0);
        _arm(_b, _bKey, _lax, address(usdc));
        (_i, _sig) = _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _one(_account(_b), _lax, 200e6));
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__SkinBelowFloor.selector, 499e18, 898e18 + 199e18, 5000));
        hub.allocate(_i, _sig);

        uint _ownerUsdc = usdc.balanceOf(_owner);
        assertEq(_drainAt(10e18, 10e18, _navUsdc()), 9e6, "the ten drained backer units park nine dollars");
        assertEq(fundStore.retiredMap(body), 10e18, "a retire within the floor is accepted while a backer waits");
        assertEq(share.balanceOf(body), 489e18, "the retired units leave the master");
        assertEq(share.balanceOf(address(fundStore)), 100e18, "ninety queued backer units and ten retired ones");
        assertEq(usdc.balanceOf(_owner), _ownerUsdc, "the drain paid the backer pool, not the owner");

        _redeemReverts(0, 91e18, abi.encodeWithSelector(Error.Fund__DrainExceedsQueue.selector, 91e18, 90e18));
        assertEq(_drainAt(0, 90e18, _navUsdc()), 89e6, "the rest of the pool parks eighty-nine");
        assertEq(share.balanceOf(address(fundStore)), 10e18, "only the retired units remain queued");
        assertEq(fundStore.getQueue(body).epoch, 1, "the backer epoch closed");
        assertEq(usdc.balanceOf(_owner), _ownerUsdc, "still nothing for the owner");
        _redeemAt(0, 10e18, _usd());
        assertEq(usdc.balanceOf(_owner) - _ownerUsdc, 9e6, "the retired units drain to the owner once no backer waits");
        assertEq(fundStore.retiredMap(body), 0, "and leave the retired book");

        _redeemReverts(
            250e18, 250e18, abi.encodeWithSelector(Error.Fund__SkinBelowFloor.selector, 239e18, 538e18, 5000)
        );
        _redeemReverts(
            190e18 + 1,
            190e18 + 1,
            abi.encodeWithSelector(Error.Fund__SkinBelowFloor.selector, 299e18 - 1, 598e18 - 1, 5000)
        );
        _ownerUsdc = usdc.balanceOf(_owner);
        _redeemAt(190e18, 190e18, _usd());
        assertEq(share.balanceOf(body), 299e18, "the master retires exactly down to the floor");
        assertEq(usdc.balanceOf(_owner) - _ownerUsdc, 189e6, "and is paid for it at once, no backer being queued");

        uint _before = usdc.balanceOf(_acctA);
        _sell(_a, _aKey, 299e18);
        assertEq(
            usdc.balanceOf(_acctA) - _before, 98e6 - FEE, "the next sell settles the closed epoch at a loss, no fee"
        );
        assertEq(usdc.balanceOf(address(fundStore)), 0, "the closed epoch paid out whole");

        _redeemReverts(299e18, 1, abi.encodeWithSelector(Error.Fund__SkinBelowFloor.selector, 0, 299e18, 5000));
        assertEq(_drainAt(0, 299e18, _navUsdc()), 298e6, "the second epoch's pool parks its value net of the fee");
        _ownerUsdc = usdc.balanceOf(_owner);
        _redeemAt(299e18, 299e18, _usd());
        assertEq(share.totalSupply(), 0, "with no backers left the floor lifts and the master leaves entirely");
        assertEq(usdc.balanceOf(_owner) - _ownerUsdc, 298e6, "the full exit pays the owner");

        _before = usdc.balanceOf(_acctA);
        _ownerUsdc = usdc.balanceOf(_owner);
        uint _paid = Math.mulDiv(299e18, Math.mulDiv(298e6, ACC, 299e18), ACC);
        hub.claim(body, share, _acctA);
        assertEq(usdc.balanceOf(_acctA) - _before, _paid, "the last backer collects its epoch");
        assertEq(usdc.balanceOf(_owner), _ownerUsdc, "a losing epoch pays the owner nothing");
        assertEq(usdc.balanceOf(address(fundStore)), 298e6 - _paid, "only rounding dust stays in the store");
    }

    function test_native_drain_pays_backers_in_native() public {
        _openFund("EE");
        vm.deal(master, 1 ether);
        vm.prank(master);
        hub.depositEscrow{value: 1 ether}(body, NATIVE_TOKEN, 1 ether);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(
            _nonceOf(body),
            _navUsdc(),
            _spot(NATIVE_TOKEN),
            _credit(block.chainid, NATIVE_TOKEN, 1 ether),
            new Fund.Allocation[](0)
        );
        uint _relayEth = Math.mulDiv(FEE * USD, 1e18, SPOT * 1e6 * USD, Math.Rounding.Ceil);
        hub.allocate(_i, _sig);
        assertEq(body.balance, 1 ether - _relayEth, "the body holds native net of the fee");

        (address _a, uint _aKey) = makeAddrAndKey("ee-native");
        _fundWallet(_a, 1000e6);
        address _acct = _account(_a);
        AccountLib.Mandate memory _m = _terms(0);
        _arm(_a, _aKey, _m, address(usdc));
        (_i, _sig) = _allocateIntent(_nonceOf(body), _navUsdc(), _one(_acct, _m, 400e6));
        uint _minted = Math.mulDiv(399e30, share.totalSupply() + VU, _navUsdc() * USD + VV);
        hub.allocate(_i, _sig);
        uint _units = share.balanceOf(_acct);
        assertEq(_units, _minted, "a USDC row is priced against a valuation that counts the native");
        _sell(_a, _aKey, _units);

        uint _storeEth = address(fundStore).balance;
        uint _bodyEth = body.balance;
        uint _relayBefore = feeReceiver.balance;
        uint _cashEth = Math.mulDiv(
            Math.mulDiv(_units / 10, _navUsdc() * USD + VV, share.totalSupply() + VU), 1e18, SPOT * 1e6 * USD
        );
        _redeemAt(0, _units / 10, _spot(NATIVE_TOKEN));
        uint _parked = _cashEth - _relayEth;
        assertEq(_bodyEth - body.balance, _cashEth, "a native drain moves the drained units' value in native");
        assertEq(feeReceiver.balance - _relayBefore, _relayEth, "and bills the signed relay fee in native");
        assertEq(address(fundStore).balance - _storeEth, _parked, "and parks the rest for the backers");

        uint _parkedUsdc = _drainAt(0, _units - _units / 10, _navUsdc());
        address[] memory _paid = fundStore.getEpochTokenList(body, 0);
        assertEq(_paid.length, 2, "the epoch paid in two tokens");
        assertEq(_paid[0], NATIVE_TOKEN, "the epoch first paid in native");
        assertEq(_paid[1], address(usdc), "and then in USDC");
        assertEq(
            fundStore.tokenAccruedMap(body, 0, NATIVE_TOKEN),
            Math.mulDiv(_parked, ACC, _units),
            "the native accrual is what the native drain parked"
        );
        assertEq(
            fundStore.tokenAccruedMap(body, 0, address(usdc)),
            Math.mulDiv(_parkedUsdc, ACC, _units),
            "the USDC accrual is what the USDC drain parked"
        );
        assertEq(_claimSplit(_acct, 400e30), 0, "a losing exit pays no performance fee");
        assertEq(
            address(fundStore).balance,
            _storeEth + _parked - Math.mulDiv(_units, Math.mulDiv(_parked, ACC, _units), ACC),
            "the native parked for the backer left the store but rounding dust"
        );
    }

    function test_known_stall_steady_sells_with_half_drains_end_in_drain_leaves_dust() public {
        _openFund("ST");
        (address _a, uint _aKey) = makeAddrAndKey("ee-steady");
        _fundWallet(_a, 1000e6);
        AccountLib.Mandate memory _m = _terms(0);
        _arm(_a, _aKey, _m, address(usdc));
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _one(_account(_a), _m, 400e6));
        hub.allocate(_i, _sig);
        uint _clampedAt;
        uint _stalledAt;
        for (uint _k; _k < 40; ++_k) {
            _sell(_a, _aKey, 8e18);
            uint _pool = share.balanceOf(address(fundStore));
            FundStore.Queue memory _q = fundStore.getQueue(body);
            uint _floor = Math.ceilDiv(_q.weight, 1e6);
            (Fund.RedeemIntent memory _r, bytes memory _rs) =
                _redeemIntent(0, _pool / 2, _usd(), usdc.balanceOf(body), FEE * USD);
            if (_pool <= _floor) {
                vm.expectRevert(abi.encodeWithSelector(Error.Fund__DrainLeavesDust.selector, _pool, _floor));
                hub.redeem(_r, _rs);
                _stalledAt = _k + 1;
                break;
            }
            hub.redeem(_r, _rs);
            uint _drained = _pool - share.balanceOf(address(fundStore));
            assertEq(_drained, Math.min(_pool / 2, _pool - _floor), "a partial drain stops at the weight floor");
            if (_drained < _pool / 2 && _clampedAt == 0) _clampedAt = _k + 1;
            assertEq(fundStore.getQueue(body).epoch, 0, "a partial drain never closes the epoch");
        }
        assertEq(_clampedAt, 20, "the weight ratio doubles per half drain until the floor clamps the twentieth");
        assertEq(_stalledAt, 21, "and the next one finds the floor has swallowed the whole pool");
        _redeemAt(0, share.balanceOf(address(fundStore)), _usd());
        assertEq(share.balanceOf(address(fundStore)), 0, "a full drain of the pool still clears the stall");
        assertEq(fundStore.getQueue(body).epoch, 1, "and opens a fresh epoch");
        assertEq(fundStore.getQueue(body).weight, 0, "with no weight carried over");
    }

    function _backer(
        string memory _tag,
        uint _skin,
        uint _amount
    ) internal returns (address user_, uint key_, address acct_) {
        (user_, key_) = makeAddrAndKey(_tag);
        _fundWallet(user_, 1000e6);
        acct_ = _account(user_);
        AccountLib.Mandate memory _m = _terms(_skin);
        _arm(user_, key_, _m, address(usdc));
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(_nonceOf(body), _navUsdc(), _one(acct_, _m, _amount));
        hub.allocate(_i, _sig);
    }

    function _drainAt(
        uint _retire,
        uint _units,
        uint _nav
    ) internal returns (uint parked_) {
        uint _body = usdc.balanceOf(body);
        uint _store = usdc.balanceOf(address(fundStore));
        uint _relay = usdc.balanceOf(feeReceiver);
        uint _cashValue = Math.mulDiv(_units, _nav * USD + VV, share.totalSupply() + VU);
        (Fund.RedeemIntent memory _i, bytes memory _sig) = _redeemIntent(_retire, _units, _usd(), _nav, FEE * USD);
        hub.redeem(_i, _sig);
        parked_ = _cashValue / 1e24 - FEE;
        assertGe(_cashValue, 10 * FEE * USD, "these drains move at least ten relay fees");
        assertEq(_body - usdc.balanceOf(body), _cashValue / 1e24, "the drain moves exactly the drained units' value");
        assertEq(usdc.balanceOf(feeReceiver) - _relay, FEE, "the drain pays its own relay fee out of that cash");
        assertEq(usdc.balanceOf(address(fundStore)) - _store, parked_, "and parks the rest for the pool");
    }

    function _twoDrainExit(
        address _acct,
        uint _units,
        uint _firstNav,
        uint _secondNav,
        bool _settleBetween
    ) internal returns (uint[6] memory out_) {
        address _owner = _account(master);
        uint _held = usdc.balanceOf(_acct);
        uint _owned = usdc.balanceOf(_owner);
        out_[4] = _drainAt(0, _units / 2, _firstNav);
        if (_settleBetween) {
            vm.prank(master);
            hub.claim(body, share, _acct);
            out_[0] = usdc.balanceOf(_acct) - _held;
            out_[1] = usdc.balanceOf(_owner) - _owned;
        }
        out_[5] = _drainAt(0, share.balanceOf(address(fundStore)), _secondNav);
        hub.claim(body, share, _acct);
        out_[2] = usdc.balanceOf(_acct) - _held;
        out_[3] = usdc.balanceOf(_owner) - _owned;
    }

    function test_fee_is_path_independent_when_a_loss_drain_precedes_a_gain_drain() public {
        _openFund("LG");
        (address _a, uint _aKey, address _acct) = _backer("lg-a", 0, 400e6);
        _sell(_a, _aKey, 399e18);
        uint _snap = vm.snapshotState();
        uint[6] memory _between = _twoDrainExit(_acct, 399e18, 450e6, 2000e6, true);
        vm.revertToState(_snap);
        uint[6] memory _atEnd = _twoDrainExit(_acct, 399e18, 450e6, 2000e6, false);

        assertLt(_between[0], 200e6, "the first window paid back less than its half of the basis");
        assertApproxEqAbs(_between[0], _between[4], 1, "the lone holder collects all the first drain parked");
        assertEq(_between[1], 0, "no fee on a losing window");
        uint _gross = _atEnd[2] + _atEnd[3];
        assertGt(_gross, 400e6, "the exit was profitable overall");
        assertApproxEqAbs(
            _gross, _atEnd[4] + _atEnd[5], 1, "the holder and the owner split exactly what both drains parked"
        );
        assertApproxEqAbs(
            _atEnd[3], (_gross - 400e6) / 10, 2, "the fee is a tenth of the net profit over the whole basis"
        );
        assertApproxEqAbs(_between[3], _atEnd[3], 1, "a settle between the drains changes nothing about the fee");
        assertApproxEqAbs(_between[2], _atEnd[2], 1, "nor about what the holder collects");
    }

    function test_fee_is_path_independent_when_a_gain_drain_precedes_a_loss_drain() public {
        _openFund("GL");
        (address _a, uint _aKey, address _acct) = _backer("gl-a", 0, 400e6);
        _sell(_a, _aKey, 399e18);
        uint _snap = vm.snapshotState();

        uint[6] memory _between = _twoDrainExit(_acct, 399e18, 1350e6, 175e6, true);
        vm.revertToState(_snap);
        uint[6] memory _atEnd = _twoDrainExit(_acct, 399e18, 1350e6, 175e6, false);
        assertGt(_between[0], 200e6, "the first window alone paid more than its half of the basis");
        assertApproxEqAbs(_between[0], _between[4], 1, "the lone holder collects all the first drain parked");
        assertEq(_between[1], 0, "yet basis comes back first, so that settle charges nothing");
        assertLt(_atEnd[2], 400e6, "the exit lost money overall");
        assertApproxEqAbs(_atEnd[2], _atEnd[4] + _atEnd[5], 1, "the losing holder collects all both drains parked");
        assertEq(_between[3], 0, "a losing exit pays no fee when settled between the drains");
        assertEq(_atEnd[3], 0, "nor when settled once at the end");
        assertApproxEqAbs(_between[2], _atEnd[2], 1, "the holder collects the same either way");

        vm.revertToState(_snap);
        _between = _twoDrainExit(_acct, 399e18, 2000e6, 175e6, true);
        vm.revertToState(_snap);
        _atEnd = _twoDrainExit(_acct, 399e18, 2000e6, 175e6, false);
        uint _gross = _atEnd[2] + _atEnd[3];
        assertGt(_between[0] + _between[1], 400e6, "the first window alone returned the whole basis");
        assertApproxEqAbs(
            _between[0] + _between[1], _between[4], 1, "the first settle splits exactly what the first drain parked"
        );
        assertApproxEqAbs(
            _between[1], (_between[0] + _between[1] - 400e6) / 10, 1, "so its settle charges a tenth of the excess only"
        );
        assertGt(_gross, 400e6, "the exit gained overall");
        assertApproxEqAbs(
            _gross, _atEnd[4] + _atEnd[5], 1, "the holder and the owner split exactly what both drains parked"
        );
        assertApproxEqAbs(_atEnd[3], (_gross - 400e6) / 10, 2, "the fee is a tenth of the net profit");
        assertApproxEqAbs(_between[3], _atEnd[3], 1, "whatever the settle order");
        assertApproxEqAbs(_between[2], _atEnd[2], 1, "and the holder collects the same");
    }

    function test_drain_relay_fee_is_capped_at_a_tenth_of_the_cash_it_moves() public {
        _openFund("CAP");
        (address _a, uint _aKey,) = _backer("cap-a", 0, 400e6);
        _sell(_a, _aKey, 399e18);
        uint _relay = usdc.balanceOf(feeReceiver);
        uint _store = usdc.balanceOf(address(fundStore));
        uint _body = usdc.balanceOf(body);
        _redeemAt(0, 5e18, _usd());
        assertEq(_body - usdc.balanceOf(body), 5e6, "a five dollar drain moves five dollars");
        assertEq(
            usdc.balanceOf(feeReceiver) - _relay,
            0.5e6,
            "a five dollar drain bills a tenth of its cash, not the signed dollar"
        );
        assertEq(usdc.balanceOf(address(fundStore)) - _store, 4.5e6, "the pool gets the rest");

        _relay = usdc.balanceOf(feeReceiver);
        _store = usdc.balanceOf(address(fundStore));
        _body = usdc.balanceOf(body);
        _redeemAt(0, 20e18, _usd());
        assertEq(_body - usdc.balanceOf(body), 20e6, "a twenty dollar drain moves twenty dollars");
        assertEq(usdc.balanceOf(feeReceiver) - _relay, FEE, "above ten dollars the signed fee binds");
        assertEq(usdc.balanceOf(address(fundStore)) - _store, 19e6, "the pool gets the rest");

        _relay = usdc.balanceOf(feeReceiver);
        _store = usdc.balanceOf(address(fundStore));
        _body = usdc.balanceOf(body);
        uint _queued = share.balanceOf(address(fundStore));
        _redeemAt(0, 1, _usd());
        assertEq(
            share.balanceOf(address(fundStore)),
            _queued - 1,
            "a one-wei drain is accepted rather than refused as unfunded"
        );
        assertEq(usdc.balanceOf(feeReceiver), _relay, "it bills nothing");
        assertEq(usdc.balanceOf(address(fundStore)), _store, "parks nothing");
        assertEq(usdc.balanceOf(body), _body, "and moves nothing out of the body");
    }

    function _gainingExit(
        string memory _tag
    ) internal returns (address acct_, uint gross_, uint fee_) {
        (address _a, uint _aKey, address _acct) = _backer(_tag, 0, 400e6);
        acct_ = _acct;
        _sell(_a, _aKey, 399e18);
        usdc.mint(body, 300e6);
        uint _parked = _drainAt(0, 399e18, _navUsdc());
        FundStore.Position memory _p = fundStore.getPosition(body, acct_);
        gross_ = Math.mulDiv(_p.weight, fundStore.tokenAccruedMap(body, 0, address(usdc)), ACC);
        assertApproxEqAbs(gross_, _parked, 1, "the lone holder is owed all the drain parked");
        uint _payout = Math.mulDiv(_p.weight, fundStore.accruedMap(body, 0), ACC);
        fee_ = Math.mulDiv(gross_, (_payout - 400e30) * 1000 / 10_000, _payout);
        assertGt(fee_, 0, "the exit gained, so it owes a fee");
    }

    function test_owner_who_cannot_receive_is_owed_and_the_backer_exit_still_settles() public {
        _openFund("OWN");
        (address _acct, uint _gross, uint _fee) = _gainingExit("own-a");
        address _owner = _account(master);
        uint _held = usdc.balanceOf(_acct);
        uint _owned = usdc.balanceOf(_owner);
        vm.mockCallRevert(address(usdc), abi.encodeWithSelector(IERC20.transfer.selector, _owner), "blocked");
        hub.claim(body, share, _acct);
        vm.clearMockedCalls();
        assertEq(
            usdc.balanceOf(_acct) - _held, _gross - _fee, "the backer is paid in full although the owner cannot receive"
        );
        assertEq(usdc.balanceOf(_owner), _owned, "the blocked owner received nothing");
        assertEq(fundStore.owedMap(_owner, address(usdc)), _fee, "its fee is booked as owed");

        hub.payOwed(_owner, address(usdc));
        assertEq(usdc.balanceOf(_owner) - _owned, _fee, "anyone can push the owed fee once the owner can receive");
        assertEq(fundStore.owedMap(_owner, address(usdc)), 0, "and the debt is cleared");
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__NothingToClaim.selector, _owner));
        hub.payOwed(_owner, address(usdc));
    }

    function test_holder_who_cannot_receive_is_owed_and_the_owner_fee_still_settles() public {
        _openFund("OWH");
        (address _acct, uint _gross, uint _fee) = _gainingExit("owh-a");
        address _owner = _account(master);
        uint _held = usdc.balanceOf(_acct);
        uint _owned = usdc.balanceOf(_owner);
        vm.mockCallRevert(address(usdc), abi.encodeWithSelector(IERC20.transfer.selector, _acct), "blocked");
        hub.claim(body, share, _acct);
        vm.clearMockedCalls();
        assertEq(usdc.balanceOf(_owner) - _owned, _fee, "the owner fee settles although the holder cannot receive");
        assertEq(usdc.balanceOf(_acct), _held, "the blocked holder received nothing");
        assertEq(fundStore.owedMap(_acct, address(usdc)), _gross - _fee, "its payout is booked as owed");
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__NothingToClaim.selector, _acct));
        hub.claim(body, share, _acct);

        hub.payOwed(_acct, address(usdc));
        assertEq(usdc.balanceOf(_acct) - _held, _gross - _fee, "the owed payout is pulled in full later");
        assertEq(fundStore.owedMap(_acct, address(usdc)), 0, "and the debt is cleared");
    }

    function test_mandate_skin_is_capped_at_symmetric_and_the_cap_leaves_room_to_match_the_master() public {
        _openFund("AR");
        (address _g, uint _gKey) = makeAddrAndKey("ar-griefer");
        _fundWallet(_g, 40e6);
        (HubGate.MandateIntent memory _mi, bytes memory _ms) =
            _mandateIntent(_g, _gKey, _terms(9000), new address[](0), true);
        vm.expectRevert(abi.encodeWithSelector(Error.Mandate__InvalidSkin.selector, 9000));
        hub.mandate(_mi, _ms);
        (_mi, _ms) = _mandateIntent(_g, _gKey, _terms(5001), new address[](0), true);
        vm.expectRevert(abi.encodeWithSelector(Error.Mandate__InvalidSkin.selector, 5001));
        hub.mandate(_mi, _ms);

        AccountLib.Mandate memory _mg = _terms(5000);
        _arm(_g, _gKey, _mg, address(usdc));
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _one(_account(_g), _mg, 15e6));
        hub.allocate(_i, _sig);
        assertEq(share.balanceOf(_account(_g)), 14e18, "the dust backer is minted");
        assertEq(fundStore.skinMap(body), 5000, "the strictest floor any backer can set is symmetric skin");

        (address _a, uint _aKey) = makeAddrAndKey("ar-normal");
        _fundWallet(_a, 1000e6);
        AccountLib.Mandate memory _ma = _terms(0);
        _arm(_a, _aKey, _ma, address(usdc));
        (_i, _sig) = _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _one(_account(_a), _ma, 487e6));
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__SkinBelowFloor.selector, 499e18, 999e18, 5000));
        hub.allocate(_i, _sig);
        (_i, _sig) = _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _one(_account(_a), _ma, 486e6));
        hub.allocate(_i, _sig);
        assertEq(share.balanceOf(_account(_a)), 485e18, "the raise is minted");
        assertEq(
            share.totalSupply(),
            2 * share.balanceOf(body),
            "a symmetric floor lets backers match the master's own units exactly"
        );
    }

    function test_a_backer_exits_in_full_at_a_loss_without_a_fee() public {
        _openFund("SD");
        (address _a, uint _aKey, address _acct) = _backer("sd-a", 0, 400e6);
        _sell(_a, _aKey, 399e18);
        uint _parked = _drainAt(0, 399e18, _navUsdc());
        assertEq(_claimSplit(_acct, 400e30), 0, "the backer still exits in full at a loss, no fee");
        assertEq(share.balanceOf(_acct), 0, "nothing of it stays in the fund");
        assertEq(
            usdc.balanceOf(address(fundStore)),
            _parked - Math.mulDiv(399e18, Math.mulDiv(_parked, ACC, 399e18), ACC),
            "the exit took everything parked for it but rounding dust"
        );
    }

    function test_revoking_one_mandate_keeps_other_funds_armed_and_disarming_skips_the_row() public {
        _openFund("RV");
        (address _a, uint _aKey) = makeAddrAndKey("ar-revoke");
        _fundWallet(_a, 1000e6);
        address _acct = _account(_a);
        AccountLib.Mandate memory _ma = _terms(0);
        _arm(_a, _aKey, _ma, address(usdc));
        assertEq(
            IERC20(address(usdc)).allowance(_acct, address(fundModule)), type(uint).max, "arming grants the fund module"
        );
        assertEq(mandateStore.mandateMap(_acct, body), this.digestOf(_acct, _ma), "and stores the mandate digest");

        AccountLib.Mandate memory _other = AccountLib.Mandate({
            master: address(0xBEEF), skin: 0, allocationRate: 5000, cooldownPeriod: 0, expiry: block.timestamp + 1 days
        });
        _arm(_a, _aKey, _other, address(usdc));
        assertEq(
            mandateStore.mandateMap(_acct, address(0xBEEF)), this.digestOf(_acct, _other), "a second fund is armed"
        );
        _other.expiry = block.timestamp;
        (HubGate.MandateIntent memory _mi, bytes memory _ms) =
            _mandateIntent(_a, _aKey, _other, new address[](0), false);
        hub.mandate(_mi, _ms);
        assertEq(mandateStore.mandateMap(_acct, address(0xBEEF)), bytes32(0), "an expired mandate is a revoke");
        assertEq(mandateStore.mandateMap(_acct, body), this.digestOf(_acct, _ma), "the other fund's mandate stands");
        assertEq(
            IERC20(address(usdc)).allowance(_acct, address(fundModule)),
            type(uint).max,
            "revoking one fund keeps USDC armed"
        );

        address[] memory _tokens = new address[](1);
        _tokens[0] = address(usdc);
        (_mi, _ms) = _mandateIntent(_a, _aKey, _ma, _tokens, false);
        hub.mandate(_mi, _ms);
        assertEq(IERC20(address(usdc)).allowance(_acct, address(fundModule)), 0, "a disarm zeroes the allowance");
        assertEq(mandateStore.mandateMap(_acct, body), this.digestOf(_acct, _ma), "but keeps the mandate");
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _one(_acct, _ma, 400e6));
        vm.expectRevert(Error.Balance__ZeroAmount.selector);
        hub.allocate(_i, _sig);

        _arm(_a, _aKey, _ma, address(usdc));
        (_i, _sig) = _allocateIntent(_nonceOf(body), usdc.balanceOf(body), _one(_acct, _ma, 400e6));
        hub.allocate(_i, _sig);
        assertEq(share.balanceOf(_acct), 399e18, "re-armed, the backer's live fund allocates");
    }

    function test_native_round_refuses_backer_rows() public {
        _openFund("NR");
        (address _a, uint _aKey) = makeAddrAndKey("ar-native");
        _fundWallet(_a, 1000e6);
        vm.deal(_account(_a), 10 ether);
        AccountLib.Mandate memory _ma = _terms(0);
        _arm(_a, _aKey, _ma, address(usdc));
        vm.deal(master, 1 ether);
        vm.prank(master);
        hub.depositEscrow{value: 1 ether}(body, NATIVE_TOKEN, 1 ether);
        (Fund.AllocateIntent memory _i, bytes memory _sig) = _allocateIntent(
            _nonceOf(body),
            usdc.balanceOf(body),
            _spot(NATIVE_TOKEN),
            _credit(block.chainid, NATIVE_TOKEN, 1 ether),
            _one(_account(_a), _ma, 1 ether)
        );
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__NativeRowsUnsupported.selector, 1));
        hub.allocate(_i, _sig);
    }

    uint vfRng;
    uint vfN;
    address[NMAX] vfUsers;
    uint[NMAX] vfKeys;
    address[NMAX] vfAccts;
    AccountLib.Mandate[NMAX] vfMandates;
    address vfOwner;
    uint vfExtra;
    uint vfStep;
    uint vfDrains;
    uint vfBodyOut;
    uint vfRelayIn;
    uint vfOwnerIn;
    uint vfStoreIn;
    uint vfStoreOut;
    uint[NMAX] vfExpected;
    uint[NMAX] vfGross;
    uint[NMAX] vfFee;
    uint[NMAX] vfBasisSold;
    uint[NMAX] vfTol;
    string vfTrace;

    function _vfR() internal returns (uint) {
        vfRng = uint(keccak256(abi.encode(vfRng)));
        return vfRng;
    }

    function _vfLog(
        string memory _s
    ) internal {
        vfTrace = string.concat(vfTrace, vm.toString(vfStep), ":", _s, " | ");
    }

    function _vfPool() internal view returns (uint) {
        return share.balanceOf(address(fundStore)) - fundStore.retiredMap(body);
    }

    function _vfNav() internal view returns (uint) {
        return (usdc.balanceOf(body) + vfExtra) * USD;
    }

    function _vfSetup(
        uint _n,
        uint _seed
    ) internal {
        vfN = _n;
        usdc.mint(address(fundStore), OTHER_FUNDS);
        _openFund("VF");
        vfOwner = _account(master);
        uint[4] memory _skins = [uint(0), 0, 1000, 5000];
        for (uint _j; _j < _n; ++_j) {
            (vfUsers[_j], vfKeys[_j]) = makeAddrAndKey(string.concat("vf-", vm.toString(_j)));
            vfAccts[_j] = _account(vfUsers[_j]);
            _fundWallet(vfUsers[_j], 20_000e6);
            vfMandates[_j] = AccountLib.Mandate({
                master: body,
                skin: _skins[uint(keccak256(abi.encode(_seed, _j))) % 4],
                allocationRate: 9000,
                cooldownPeriod: 0,
                expiry: block.timestamp + 365 days
            });
            _arm(vfUsers[_j], vfKeys[_j], vfMandates[_j], address(usdc));
        }
    }

    function _vfPriceNotDown(
        uint _navBefore,
        uint _supplyBefore,
        string memory _what
    ) internal view {
        uint _supplyAfter = share.totalSupply();
        if (_supplyAfter == 0) return;
        assertGe(
            Math.mulDiv(_vfNav() + VV, _supplyBefore + VU, _supplyAfter + VU)
                + Math.mulDiv(2 * USD, _supplyBefore + VU, _supplyAfter + VU) + 2,
            _navBefore + VV,
            string.concat(_what, ": the unit price fell for the holders who stayed. trace=", vfTrace)
        );
    }

    function _vfAllocate() internal {
        uint _mask = _vfR() % 2 ** vfN;
        bool _masterLeg = _vfR() % 3 == 0;
        uint _count;
        for (uint _j; _j < vfN; ++_j) {
            if ((_mask >> _j) & 1 == 1) ++_count;
        }
        Fund.Allocation[] memory _rows = new Fund.Allocation[](_count);
        uint _n;
        for (uint _j; _j < vfN; ++_j) {
            if ((_mask >> _j) & 1 == 0) continue;
            uint _stake = 5e6 + _vfR() % 3000e6;
            uint _k = _n;
            while (_k > 0 && uint160(_rows[_k - 1].puppet) > uint160(vfAccts[_j])) {
                _rows[_k] = _rows[_k - 1];
                --_k;
            }
            _rows[_k] = Fund.Allocation({puppet: vfAccts[_j], mandate: vfMandates[_j], amount: _stake});
            ++_n;
        }
        Fund.Credit memory _c = _credit(0, address(0), 0);
        if (_masterLeg) {
            uint _amt = 1e6 + _vfR() % 2000e6;
            _fundWallet(master, _amt + FEE);
            _escrow(LiquidityGate(address(hub)), address(usdc), _amt);
            _c = _credit(block.chainid, address(usdc), _amt);
        }
        if (_count == 0 && !_masterLeg) return;
        _vfLog(string.concat("alloc mask=", vm.toString(_mask), " master=", vm.toString(_c.amount)));
        _vfAllocateChecked(_rows, _c);
    }

    function _vfAllocateExpect(
        Fund.Allocation[] memory _rows,
        Fund.Credit memory _c
    ) internal view returns (uint[] memory units_, uint masterUnits_, uint relay_, bytes memory refusal_) {
        uint _supply = share.totalSupply() + VU;
        uint _nav = _vfNav() + VV;
        uint _mu = share.balanceOf(body);
        uint _exposed = share.totalSupply() - fundStore.retiredMap(body);
        uint _skin = _exposed > _mu ? fundStore.skinMap(body) : 0;
        uint _leg = _c.amount > 0 ? 1 : 0;
        uint _slice = FEE * USD / (_rows.length + _leg);
        uint _included;
        uint _minted;
        units_ = new uint[](_rows.length);
        for (uint _k; _k < _rows.length; ++_k) {
            uint _value = _rows[_k].amount * USD;
            uint _basis = fundStore.getHolding(body, _rows[_k].puppet).basis;
            if (
                _slice * 10 >= _value
                    || (_basis + _value) * 10_000
                        > (usdc.balanceOf(_rows[_k].puppet) * USD + _basis) * _rows[_k].mandate.allocationRate
            ) continue;
            ++_included;
            units_[_k] = Math.mulDiv(_value - _slice, _supply, _nav);
            if (_rows[_k].mandate.skin > _skin) _skin = _rows[_k].mandate.skin;
            _minted += units_[_k];
        }
        relay_ = _slice * _included / USD;
        if (_leg > 0) {
            uint _masterBilled = Math.ceilDiv(_slice, USD);
            if (_c.amount <= _masterBilled) {
                return (
                    units_, 0, 0, abi.encodeWithSelector(Error.Fund__FeeUnfunded.selector, _c.amount, _masterBilled)
                );
            }
            masterUnits_ = Math.mulDiv(_c.amount * USD - _slice, _supply, _nav);
            relay_ += _masterBilled;
            _mu += masterUnits_;
            _minted += masterUnits_;
        }
        if (_minted == 0) {
            refusal_ = abi.encodeWithSelector(Error.Balance__ZeroAmount.selector);
        } else if (_mu * 10_000 < (_exposed + _minted) * _skin) {
            refusal_ = abi.encodeWithSelector(Error.Fund__SkinBelowFloor.selector, _mu, _exposed + _minted, _skin);
        }
    }

    function _vfAllocateChecked(
        Fund.Allocation[] memory _rows,
        Fund.Credit memory _c
    ) internal returns (bool ok_) {
        (uint[] memory _units, uint _masterUnits, uint _relay, bytes memory _refusal) = _vfAllocateExpect(_rows, _c);
        uint[] memory _held = new uint[](_rows.length);
        for (uint _k; _k < _rows.length; ++_k) {
            _held[_k] = share.balanceOf(_rows[_k].puppet);
        }
        uint[4] memory _b = [
            share.balanceOf(body),
            usdc.balanceOf(feeReceiver),
            usdc.balanceOf(address(fundStore)),
            share.totalSupply()
        ];
        uint _navBefore = _vfNav();
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(_nonceOf(body), usdc.balanceOf(body) + vfExtra, _c, _rows);
        try hub.allocate(_i, _sig) {
            ok_ = true;
        } catch (bytes memory _err) {
            assertEq(_err, _refusal, string.concat("the allocate refused where the round rules do not. trace=", vfTrace));
            _vfLog("alloc-revert");
            return false;
        }
        assertEq(_refusal.length, 0, string.concat("the allocate went through where a refusal was due. trace=", vfTrace));
        for (uint _k; _k < _rows.length; ++_k) {
            assertEq(
                share.balanceOf(_rows[_k].puppet) - _held[_k],
                _units[_k],
                "each row mints its value net of its fee slice at the round's unit price, or is skipped"
            );
        }
        assertEq(share.balanceOf(body) - _b[0], _masterUnits, "the master leg mints its value net of its fixed slice");
        assertEq(usdc.balanceOf(feeReceiver) - _b[1], _relay, "the round bills exactly the slices it took");
        assertEq(usdc.balanceOf(address(fundStore)), _b[2], "allocate never touches the exit store");
        _vfPriceNotDown(_navBefore, _b[3], "allocate");
    }

    function _vfPark() internal {
        uint _amt = _vfR() % (usdc.balanceOf(body) + 1);
        if (_amt == 0) return;
        vm.prank(body);
        IERC20(address(usdc)).transfer(SINK, _amt);
        vfExtra += _amt;
        _vfLog(string.concat("park ", vm.toString(_amt)));
    }

    function _vfRealize() internal {
        if (vfExtra == 0) return;
        usdc.mint(body, vfExtra);
        _vfLog(string.concat("realize ", vm.toString(vfExtra)));
        vfExtra = 0;
    }

    function _vfShock() internal {
        uint _bal = usdc.balanceOf(body);
        if (_vfR() % 2 == 0) {
            uint _amt = _bal * (90 + _vfR() % 10) / 100;
            vm.prank(body);
            IERC20(address(usdc)).transfer(SINK, _amt);
            vfExtra = vfExtra * (100 - 90 - _vfR() % 10) / 100;
            _vfLog(string.concat("crash ", vm.toString(_amt)));
        } else {
            uint _amt = _bal * (1 + _vfR() % 20);
            usdc.mint(body, _amt);
            _vfLog(string.concat("moon ", vm.toString(_amt)));
        }
    }

    function _vfGain() internal {
        uint _amt = _vfR() % (usdc.balanceOf(body) * 3 / 10 + 1);
        usdc.mint(body, _amt);
        _vfLog(string.concat("gain ", vm.toString(_amt)));
    }

    function _vfLoss() internal {
        uint _amt = _vfR() % (usdc.balanceOf(body) * 3 / 10 + 1);
        if (_amt == 0) return;
        vm.prank(body);
        IERC20(address(usdc)).transfer(SINK, _amt);
        _vfLog(string.concat("loss ", vm.toString(_amt)));
    }

    function _vfSell() internal {
        uint _j = _vfR() % vfN;
        uint _units = share.balanceOf(vfAccts[_j]);
        if (_units == 0) return;
        uint _amt = _units * (1 + _vfR() % 100) / 100;
        _vfSellTracked(_j, _amt == 0 ? _units : _amt);
    }

    function _vfSellTracked(
        uint _j,
        uint _amt
    ) internal {
        uint _store = usdc.balanceOf(address(fundStore));
        uint _held = usdc.balanceOf(vfAccts[_j]);
        uint _owned = usdc.balanceOf(vfOwner);
        uint _relay = usdc.balanceOf(feeReceiver);
        uint _basis = fundStore.getHolding(body, vfAccts[_j]).basis;
        uint _weight = fundStore.getQueue(body).weight;
        uint _pool = _vfPool();
        _vfLog(string.concat("sell ", vm.toString(_j), " ", vm.toString(_amt)));
        _sell(vfUsers[_j], vfKeys[_j], _amt);
        assertEq(
            fundStore.getQueue(body).weight - _weight,
            _weight == 0 ? _amt : Math.mulDiv(_amt, _weight, _pool),
            "a sell buys queue weight at the pool's weight per unit"
        );
        assertEq(_vfPool(), _pool + _amt, "and its units join the pool");
        vfBasisSold[_j] += _basis - fundStore.getHolding(body, vfAccts[_j]).basis;
        uint _out = _store - usdc.balanceOf(address(fundStore));
        uint _toOwner = usdc.balanceOf(vfOwner) - _owned;
        assertEq(
            _out,
            usdc.balanceOf(vfAccts[_j]) + FEE - _held + _toOwner,
            "a sell's settlement pays the holder and the owner exactly what left the store"
        );
        assertEq(usdc.balanceOf(feeReceiver) - _relay, FEE, "a sell bills its own relay fee only");
        vfGross[_j] += _out;
        vfFee[_j] += _toOwner;
        vfStoreOut += _out;
    }

    function _vfWeights() internal view returns (uint[NMAX] memory w_, uint pw_) {
        FundStore.Queue memory _q = fundStore.getQueue(body);
        uint _sum;
        for (uint _j; _j < vfN; ++_j) {
            FundStore.Position memory _p = fundStore.getPosition(body, vfAccts[_j]);
            if (_p.epoch == _q.epoch) {
                w_[_j] = _p.weight;
                _sum += _p.weight;
            }
        }
        pw_ = _q.weight;
        assertEq(_sum, pw_, "the positions of the open epoch carry exactly the queue weight");
    }

    function _vfRedeemExpect(
        uint _retire,
        uint _drain,
        uint _pw
    ) internal view returns (uint drained_, bytes memory refusal_) {
        uint _supply = share.totalSupply();
        uint _retired = fundStore.retiredMap(body);
        uint _pool = _vfPool();
        uint _mu = share.balanceOf(body);
        if (_retire > 0) {
            if (_mu < _retire) {
                return (0, abi.encodeWithSelector(Error.Fund__InsufficientUnits.selector, _mu, _retire));
            }
            uint _exposed = _supply - _retired - _retire;
            uint _staying = _mu - _retire;
            uint _skin = fundStore.skinMap(body);
            if (_exposed > _staying && _staying * 10_000 < _exposed * _skin) {
                return (0, abi.encodeWithSelector(Error.Fund__SkinBelowFloor.selector, _staying, _exposed, _skin));
            }
        }
        uint _queued = _pool > 0 ? _pool : _retired + _retire;
        if (_drain > _queued) {
            return (0, abi.encodeWithSelector(Error.Fund__DrainExceedsQueue.selector, _drain, _queued));
        }
        uint _bal = usdc.balanceOf(body);
        uint _gross = Math.mulDiv(_drain, _vfNav() + VV, _supply + VU) / USD;
        drained_ = _gross > _bal ? Math.mulDiv(_drain, _bal, _gross) : _drain;
        if (drained_ == 0) {
            return (0, abi.encodeWithSelector(Error.Balance__InsufficientFund.selector, address(usdc), _bal, _gross));
        }
        if (_pool > 0 && drained_ < _pool) {
            uint _floor = Math.ceilDiv(_pw, 1e6);
            if (_pool <= _floor) {
                return (0, abi.encodeWithSelector(Error.Fund__DrainLeavesDust.selector, _pool, _floor));
            }
            drained_ = Math.min(drained_, _pool - _floor);
        }
    }

    function _vfRedeem(
        uint _retire,
        uint _drain
    ) internal returns (bool ok_) {
        (uint[NMAX] memory _w, uint _pw) = _vfWeights();
        (uint _expected, bytes memory _refusal) = _vfRedeemExpect(_retire, _drain, _pw);
        uint _poolBefore = _vfPool();
        uint _retiredBefore = fundStore.retiredMap(body);
        (Fund.RedeemIntent memory _i, bytes memory _sig) =
            _redeemIntent(_retire, _drain, _usd(), usdc.balanceOf(body) + vfExtra, FEE * USD);
        uint[4] memory _b = [
            usdc.balanceOf(body),
            usdc.balanceOf(address(fundStore)),
            usdc.balanceOf(vfOwner),
            usdc.balanceOf(feeReceiver)
        ];
        uint _navBefore = _vfNav();
        uint _supplyBefore = share.totalSupply();
        uint _queuedBefore = share.balanceOf(address(fundStore)) + _retire;
        _vfLog(
            string.concat(
                "redeem r=", vm.toString(_retire), " d=", vm.toString(_drain), " pool=", vm.toString(_poolBefore)
            )
        );
        try hub.redeem(_i, _sig) {
            ok_ = true;
        } catch (bytes memory _err) {
            assertEq(_err, _refusal, string.concat("the redeem refused where the exit rules do not. trace=", vfTrace));
            _vfLog("redeem-revert");
            return false;
        }
        assertEq(_refusal.length, 0, string.concat("the redeem went through where a refusal was due. trace=", vfTrace));
        ++vfDrains;
        uint _bodyOut = _b[0] - usdc.balanceOf(body);
        uint _in = usdc.balanceOf(address(fundStore)) - _b[1];
        uint _toOwner = usdc.balanceOf(vfOwner) - _b[2];
        uint _toRelay = usdc.balanceOf(feeReceiver) - _b[3];
        uint _drained = _queuedBefore - share.balanceOf(address(fundStore));
        assertEq(_drained, _expected, "a drain burns the asked units, clamped only by the body's cash and the pool floor");
        uint _cashValue = Math.mulDiv(_drained, _navBefore + VV, _supplyBefore + VU);
        assertEq(_bodyOut, _cashValue / USD, "a drain moves exactly the drained units' value");
        assertEq(
            _toRelay,
            Math.min(Math.ceilDiv(Math.min(FEE * USD, _cashValue / 10), USD), _bodyOut),
            "a drain bills the signed fee capped at a tenth of its cash"
        );
        assertEq(_bodyOut, _in + _toOwner + _toRelay, "a drain's legs sum to what left the body");
        if (_poolBefore > 0) {
            assertEq(_toOwner, 0, "while backers are queued a drain pays the pool, never the owner");
            assertEq(fundStore.retiredMap(body), _retiredBefore + _retire, "and every retired unit keeps waiting");
        } else {
            assertEq(_in, 0, "with no backer queued nothing is parked in the store");
            assertEq(
                fundStore.retiredMap(body),
                _retiredBefore + _retire - _drained,
                "the drain comes out of the retired units"
            );
        }
        vfBodyOut += _bodyOut;
        vfRelayIn += _toRelay;
        vfOwnerIn += _toOwner;
        vfStoreIn += _in;
        if (_pw > 0) {
            for (uint _j; _j < vfN; ++_j) {
                vfExpected[_j] += Math.mulDiv(_in, _w[_j], _pw);
                if (_w[_j] > 0) vfTol[_j] += _w[_j] / 1e30 + 2;
            }
        }
        _vfPriceNotDown(_navBefore, _supplyBefore, "redeem");
    }

    function _vfDrain() internal {
        uint _pool = _vfPool();
        uint _queued = _pool > 0 ? _pool : fundStore.retiredMap(body);
        if (_queued == 0) return;
        uint _drain = _vfR() % 4 < 2 ? _queued : Math.max(1, _queued * (1 + _vfR() % 99) / 100);
        _vfRedeem(0, _drain);
    }

    function _vfRetire() internal {
        if (_vfPool() > 0 && _vfR() % 2 == 0) _vfRedeem(0, _vfPool());
        uint _mu = share.balanceOf(body);
        if (_mu == 0) return;
        uint _retire = Math.max(1, _mu * (1 + _vfR() % 100) / 100);
        _vfRedeem(_retire, 1 + _vfR() % (share.balanceOf(address(fundStore)) + _retire));
    }

    function _vfClaimOne(
        uint _j,
        address _caller
    ) internal returns (bool ok_) {
        address _holder = vfAccts[_j];
        uint _store = usdc.balanceOf(address(fundStore));
        uint _held = usdc.balanceOf(_holder);
        uint _owned = usdc.balanceOf(vfOwner);
        FundStore.Position memory _p = fundStore.getPosition(body, _holder);
        bool _owed = Math.mulDiv(_p.weight, fundStore.accruedMap(body, _p.epoch) - _p.cursor, ACC) > 0;
        vm.prank(_caller);
        try hub.claim(body, share, _holder) {
            ok_ = true;
        } catch (bytes memory _err) {
            assertEq(
                _err,
                abi.encodeWithSelector(Error.Fund__NothingToClaim.selector, _holder),
                string.concat("a claim refuses only for want of a payout. trace=", vfTrace)
            );
        }
        assertEq(ok_, _owed, string.concat("a claim goes through exactly when the holder is owed. trace=", vfTrace));
        if (!ok_) return false;
        uint _out = _store - usdc.balanceOf(address(fundStore));
        uint _toOwner = usdc.balanceOf(vfOwner) - _owned;
        assertEq(
            _out,
            usdc.balanceOf(_holder) - _held + _toOwner,
            "a claim pays the holder and the owner exactly what left the store"
        );
        vfGross[_j] += _out;
        vfFee[_j] += _toOwner;
        vfStoreOut += _out;
    }

    function _vfClaim() internal {
        uint _pick = _vfR() % (vfN + 1);
        address _caller = address(uint160(_vfR()));
        if (_pick == vfN) {
            address _stranger = address(uint160(_vfR()));
            vm.prank(_caller);
            vm.expectRevert(abi.encodeWithSelector(Error.Fund__NothingToClaim.selector, _stranger));
            hub.claim(body, share, _stranger);
            return;
        }
        _vfLog(string.concat("claim ", vm.toString(_pick)));
        _vfClaimOne(_pick, _caller);
    }

    function _vfRoundTrip() internal {
        if (_vfPool() != 0) _vfRedeem(0, _vfPool());
        if (_vfPool() != 0) return;
        uint _j = _vfR() % vfN;
        if (share.balanceOf(vfAccts[_j]) != 0) {
            _vfSellTracked(_j, share.balanceOf(vfAccts[_j]));
            _vfRedeem(0, _vfPool());
            if (_vfPool() != 0) return;
        }
        _vfClaimOne(_j, address(this));
        uint _stake = 50e6 + _vfR() % 2000e6;
        uint _before = usdc.balanceOf(vfAccts[_j]);
        _vfLog(string.concat("roundtrip ", vm.toString(_j), " stake=", vm.toString(_stake)));
        if (!_vfAllocateChecked(_one(vfAccts[_j], vfMandates[_j], _stake), _credit(0, address(0), 0))) return;
        uint _units = share.balanceOf(vfAccts[_j]);
        uint _store = usdc.balanceOf(address(fundStore));
        vfBasisSold[_j] += fundStore.getHolding(body, vfAccts[_j]).basis;
        _sell(vfUsers[_j], vfKeys[_j], _units);
        assertEq(usdc.balanceOf(address(fundStore)), _store, "a settled position's sell pays nothing");
        assertTrue(_vfRedeem(0, _units), "a full drain of a fresh position at an unchanged valuation goes through");
        _vfClaimOne(_j, address(this));
        assertApproxEqAbs(
            _before - usdc.balanceOf(vfAccts[_j]),
            3 * FEE,
            4 + _units / 1e30,
            string.concat(
                "entering and leaving at an unchanged valuation costs exactly three relay fees. trace=", vfTrace
            )
        );
    }

    function _vfCheck() internal {
        uint _retired = fundStore.retiredMap(body);
        uint _queued = share.balanceOf(address(fundStore));
        assertGe(_queued, _retired, "the retired units sit in the store");
        uint _exposed = share.totalSupply() - _retired;
        uint _mu = share.balanceOf(body);
        if (_exposed > _mu && _mu * 10_000 < _exposed * fundStore.skinMap(body)) {
            fail(string.concat("the skin floor broke. trace=", vfTrace));
        }
        assertLe(vfStoreOut, vfStoreIn, "the store never pays out more than it took in");
        assertGe(usdc.balanceOf(address(fundStore)), OTHER_FUNDS, "the store never dips into other funds' money");
        assertEq(
            fundStore.getQueue(body).weight == 0,
            _queued == _retired,
            "the queue weighs something exactly when a backer unit waits"
        );
    }

    function _vfEnd() internal {
        _vfRealize();
        for (uint _k; _k < 8; ++_k) {
            uint _pool = _vfPool();
            uint _queued = _pool > 0 ? _pool : fundStore.retiredMap(body);
            if (_queued == 0) break;
            uint _needNav = Math.mulDiv(10 * USD * 1e6, share.totalSupply() + VU, _queued);
            if (_vfNav() < _needNav) usdc.mint(body, (_needNav - _vfNav()) / USD + 1);
            _vfRedeem(0, _queued);
        }
        assertEq(
            share.balanceOf(address(fundStore)),
            0,
            string.concat("the pool and the retired units fully drain once the body holds the cash. trace=", vfTrace)
        );
        assertEq(fundStore.retiredMap(body), 0, "nothing stays retired");
        for (uint _j; _j < vfN; ++_j) {
            _vfClaimOne(_j, address(uint160(0xC1A1)));
        }
        _vfCheck();
        assertEq(vfBodyOut, vfRelayIn + vfOwnerIn + vfStoreIn, "every wei that left the body for exits is accounted");
        uint _tolSum;
        for (uint _j; _j < vfN; ++_j) {
            _tolSum += vfTol[_j];
        }
        assertLe(vfStoreIn - vfStoreOut, (vfDrains + 1) * (vfN + 1) + _tolSum, "only rounding dust stays in the store");
        for (uint _j; _j < vfN; ++_j) {
            assertApproxEqAbs(
                vfGross[_j],
                vfExpected[_j],
                vfTol[_j] + 2,
                string.concat("holder ", vm.toString(_j), " got its weight share of every drain. trace=", vfTrace)
            );
            assertLe(vfFee[_j] * 10_000, vfGross[_j] * 1000 + 10_000, "the fee never exceeds a tenth of gross");
            if (vfGross[_j] * USD > vfBasisSold[_j]) {
                assertGe(
                    vfFee[_j] * USD + (vfDrains + 2) * USD,
                    (vfGross[_j] * USD - vfBasisSold[_j]) / 10,
                    "the fee is at least a tenth of the net gain"
                );
            }
        }
    }

    function _vfRun(
        uint _seed,
        uint _n,
        uint _steps
    ) internal {
        vfRng = _seed;
        _vfSetup(_n, _seed);
        for (vfStep = 0; vfStep < _steps; ++vfStep) {
            uint _op = _vfR() % 15;
            if (_op < 3) _vfAllocate();
            else if (_op == 3) _vfGain();
            else if (_op == 4) _vfLoss();
            else if (_op < 7) _vfSell();
            else if (_op < 9) _vfDrain();
            else if (_op == 9) _vfClaim();
            else if (_op == 10) _vfRetire();
            else if (_op == 11) _vfRoundTrip();
            else if (_op == 12) _vfPark();
            else if (_op == 13) _vfRealize();
            else _vfShock();
            _vfCheck();
        }
        _vfEnd();
    }

    function testFuzz_value_is_conserved_and_split_by_weight(
        uint _seed,
        uint8 _n
    ) public {
        _vfRun(_seed, 1 + uint(_n) % NMAX, 40);
    }

    function testFuzz_value_is_conserved_over_long_fund_lives(
        uint _seed,
        uint8 _n
    ) public {
        _vfRun(_seed, 1 + uint(_n) % NMAX, 150);
    }

    function test_value_fuzz_inflated_supply_regression_seed() public {
        _vfRun(86017427602058517891884715591118, 1 + uint(17) % NMAX, 150);
    }

    function test_value_fuzz_audit_regression_seed() public {
        _vfRun(79_457_649_971_524_723_584_351_866_203_717_501_195_530_595_307_072, 1, 150);
    }
}
