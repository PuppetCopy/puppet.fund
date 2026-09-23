// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PRICE_TYPEHASH, REDEEM_INTENT_TYPEHASH, SELL_INTENT_TYPEHASH} from "src/HubGate.sol";
import {Fund, VIRTUAL_UNITS, VIRTUAL_VALUE} from "src/core/Fund.sol";
import {FundStore} from "src/core/FundStore.sol";
import {Share} from "src/core/Share.sol";
import {Error} from "src/utils/Error.sol";
import {AccountLib} from "src/utils/AccountLib.sol";
import {LiquidityGate} from "src/utils/LiquidityGate.sol";
import {NATIVE_TOKEN} from "src/utils/Native.sol";

import {HotPathTest} from "./HotPath.t.sol";

contract ExitMatrixTest is HotPathTest {
    function _open() internal {
        _fundWallet(master, 2000e6);
        bytes32 _symbol = bytes32("EXM");
        bytes memory _pixels = new bytes(154);
        share = Share(
            address(
                uint160(
                    uint(
                        keccak256(
                            abi.encodePacked(
                                bytes1(0xff),
                                address(hub),
                                bytes32(uint(uint160(body))),
                                keccak256(
                                    _cloneCode(fundModule.shareImpl(), abi.encodePacked(_symbol, _pixels, uint16(1000)))
                                )
                            )
                        )
                    )
                )
            )
        );
        _escrow(LiquidityGate(address(hub)), address(usdc), 500e6);
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(0, 0, _credit(block.chainid, address(usdc), 500e6), new Fund.Allocation[](0));
        bytes32 _genesis = AccountLib.genesisDigest(address(accountModule), body, _account(master));
        hub.createFund(_symbol, _pixels, _coSig(bodyKey, _genesis), _coSig(masterKey, _genesis), _i, _sig);
        assertEq(share.balanceOf(body), 499e18, "the opening round mints the master at one unit per 1e12 value");
        assertEq(usdc.balanceOf(body), 499e6, "and lands the escrow net of the round fee");
    }

    function _back(
        string memory _tag,
        uint _skin,
        uint _amount
    ) internal returns (address user_, uint key_) {
        (user_, key_) = makeAddrAndKey(_tag);
        _fundWallet(user_, _amount * 2 + 10e6);
        AccountLib.Mandate memory _m = AccountLib.Mandate({
            master: body, skin: _skin, allocationRate: 5000, cooldownPeriod: 0, expiry: block.timestamp + 365 days
        });
        AccountLib.Mandate[] memory _one = new AccountLib.Mandate[](1);
        _one[0] = _m;
        _mandate(user_, key_, _one);
        Fund.Allocation[] memory _rows = new Fund.Allocation[](1);
        _rows[0] = Fund.Allocation({puppet: _account(user_), mandate: _m, amount: _amount});
        uint _units = share.balanceOf(_account(user_));
        (Fund.AllocateIntent memory _i, bytes memory _sig) =
            _allocateIntent(_nonceOf(body), share.totalSupply() / 1e12, _rows);
        hub.allocate(_i, _sig);
        assertEq(
            share.balanceOf(_account(user_)),
            _units + _amount * 1e12 - 1e18,
            "a backer is minted at the unit price net of the round fee"
        );
    }

    function _usd() internal view returns (Fund.Price memory) {
        return Fund.Price({token: address(usdc), amount: 1e6, value: 1e6 * USD});
    }

    function _out() internal view returns (Fund.Price memory) {
        return Fund.Price({token: address(outToken), amount: 1e18, value: 2000e6 * USD});
    }

    function _eth() internal pure returns (Fund.Price memory) {
        return Fund.Price({token: NATIVE_TOKEN, amount: 1e18, value: 2000e6 * USD});
    }

    function _redeemIntent(
        uint _retire,
        uint _drain,
        uint _unitPrice,
        Fund.Price memory _price,
        uint _fee
    ) internal view returns (Fund.RedeemIntent memory i_, bytes memory sig_) {
        i_ = Fund.RedeemIntent({
            header: _fundHeader(_nonceOf(body)),
            share: share,
            valuation: _valuation(0),
            price: _price,
            retire: _retire,
            drain: _drain
        });
        i_.header.fee = _fee;
        i_.valuation.value = _unitPrice * (share.totalSupply() + VIRTUAL_UNITS) - VIRTUAL_VALUE;
        sig_ = _pair(
            masterKey,
            _typed(
                body,
                keccak256(
                    abi.encode(
                        REDEEM_INTENT_TYPEHASH,
                        _hashHeader(i_.header),
                        i_.share,
                        _valuationHash(i_.valuation),
                        keccak256(abi.encode(PRICE_TYPEHASH, i_.price.token, i_.price.amount, i_.price.value)),
                        i_.retire,
                        i_.drain
                    )
                )
            )
        );
    }

    function _drainAt(
        uint _retire,
        uint _drain,
        uint _unitPrice,
        Fund.Price memory _price
    ) internal {
        (Fund.RedeemIntent memory _i, bytes memory _sig) = _redeemIntent(_retire, _drain, _unitPrice, _price, FEE * USD);
        hub.redeem(_i, _sig);
    }

    function _sellIntent(
        address _user,
        uint _key,
        uint _units
    ) internal returns (Fund.SellIntent memory i_, bytes memory sig_) {
        address _acct = _account(_user);
        i_ = Fund.SellIntent({header: _header(_acct, _user, _nonceOf(_acct)), master: body, share: share, units: _units});
        sig_ = _pair(
            _key,
            _typed(
                _acct, keccak256(abi.encode(SELL_INTENT_TYPEHASH, _hashHeader(i_.header), i_.master, i_.share, i_.units))
            )
        );
    }

    function _assertQueue(
        uint _epoch,
        uint _weight
    ) internal view {
        FundStore.Queue memory _q = fundStore.getQueue(body);
        assertEq(_q.epoch, _epoch, "queue epoch");
        assertEq(_q.weight, _weight, "queue weight");
    }

    function _assertClosed(
        address _holder,
        uint _epoch
    ) internal {
        FundStore.Position memory _p = fundStore.getPosition(body, _holder);
        assertEq(_p.weight, 0, "a settled closed position holds no weight");
        assertEq(_p.basis, 0, "and no basis");
        assertEq(_p.epoch, _epoch, "and points at the current epoch");
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__NothingToClaim.selector, _holder));
        hub.claim(body, share, _holder);
    }

    function test_exit_conservation_across_epochs_tokens_and_retire() public {
        usdc.mint(address(fundStore), 1_000_000e6);
        outToken.mint(address(fundStore), 1_000e18);
        _open();
        (address _a, uint _aKey) = _back("em-a", 0, 401e6);
        (address _b, uint _bKey) = _back("em-b", 0, 201e6);
        outToken.mint(body, 1e18);

        address[6] memory _who =
            [body, address(fundStore), feeReceiver, _account(master), _account(_a), _account(_b)];
        uint[6] memory _usdc0;
        uint[6] memory _out0;
        for (uint _k; _k < 6; ++_k) {
            _usdc0[_k] = usdc.balanceOf(_who[_k]);
            _out0[_k] = outToken.balanceOf(_who[_k]);
        }

        _sell(_a, _aKey, 200e18);
        _drainAt(0, 200e18, 1.2e12, _usd());
        _assertQueue(1, 0);
        assertEq(fundStore.accruedMap(body, 0), 1.195e60, "epoch 0 accrues the drained value net of the relay fee");

        _sell(_b, _bKey, 100e18);
        _drainAt(0, 50e18, 1.5e12, _out());
        _assertQueue(1, 100e18);
        assertEq(fundStore.tokenAccruedMap(body, 1, address(outToken)), 3.7e44, "OUT accrues per unit of queue weight");

        _sell(_b, _bKey, 50e18);
        assertEq(outToken.balanceOf(_who[5]), _out0[5] + 3.7e16, "a same-epoch re-sell settles the partial drain first");
        _assertQueue(1, 200e18);

        _sell(_a, _aKey, 150e18);
        assertEq(
            usdc.balanceOf(_who[4]), _usdc0[4] + 235.15e6 - 2 * FEE, "a re-sell after a closed epoch settles it inside the sell"
        );
        assertEq(usdc.balanceOf(_who[3]), _usdc0[3] + 3.85e6, "and pays the owner 10% of the gain above basis");
        _assertQueue(1, 500e18);
        assertEq(
            fundStore.tokenCursorMap(body, _who[4], 1, address(outToken)),
            3.7e44,
            "a fresh seller starts at the epoch's current token accrual"
        );

        _drainAt(0, 250e18, 2e12, _usd());
        _assertQueue(2, 0);

        _drainAt(100e18, 100e18, 1.5e12, _out());
        assertEq(fundStore.retiredMap(body), 0, "the retired units are drained");
        assertEq(outToken.balanceOf(_who[3]), _out0[3] + 7.45e16, "the master's cash goes to the owner account");
        _assertQueue(2, 0);

        hub.claim(body, share, _who[4]);
        hub.claim(body, share, _who[5]);
        _assertClosed(_who[4], 2);
        _assertClosed(_who[5], 2);

        address[] memory _tokens0 = fundStore.getEpochTokenList(body, 0);
        address[] memory _tokens1 = fundStore.getEpochTokenList(body, 1);
        assertEq(_tokens0.length, 1, "epoch 0 lists USDC once");
        assertEq(_tokens0[0], address(usdc));
        assertEq(_tokens1.length, 2, "epoch 1 lists each drained token once");
        assertEq(_tokens1[0], address(outToken));
        assertEq(_tokens1[1], address(usdc));

        uint _drainedUsdc = 240e6 + 500e6;
        uint _drainedOut = 3.75e16 + 7.5e16;
        assertEq(usdc.balanceOf(_who[0]), _usdc0[0] - _drainedUsdc, "the body paid exactly the USDC cash legs");
        assertEq(outToken.balanceOf(_who[0]), _out0[0] - _drainedOut, "the body paid exactly the OUT cash legs");

        uint[4] memory _usdcIn = [
            usdc.balanceOf(_who[4]) + 2 * FEE - _usdc0[4],
            usdc.balanceOf(_who[5]) + 2 * FEE - _usdc0[5],
            usdc.balanceOf(_who[3]) - _usdc0[3],
            usdc.balanceOf(_who[2]) - 4 * FEE - _usdc0[2]
        ];
        uint[4] memory _outIn = [
            outToken.balanceOf(_who[4]) - _out0[4],
            outToken.balanceOf(_who[5]) - _out0[5],
            outToken.balanceOf(_who[3]) - _out0[3],
            outToken.balanceOf(_who[2]) - _out0[2]
        ];
        assertEq(_usdcIn[0], 519.6475e6, "A: 235.15 from epoch 0 and 284.4975 from epoch 1");
        assertEq(_usdcIn[1], 187.315e6, "B: 199.6 less its 12.285 fee");
        assertEq(_usdcIn[2], 31.0375e6, "owner: 3.85 + 14.9025 + 12.285 of performance fee");
        assertEq(_usdcIn[3], 2e6, "relay: one capped fee per USDC drain");
        assertEq(_outIn[0], 0, "A joined epoch 1 after the OUT drain");
        assertEq(_outIn[1], 3.7e16, "B: the OUT drain net of its relay fee");
        assertEq(_outIn[2], 7.45e16, "owner: the retired drain");
        assertEq(_outIn[3], 1e15, "relay: one fee per OUT drain");
        assertEq(
            _usdcIn[0] + _usdcIn[1] + _usdcIn[2] + _usdcIn[3], _drainedUsdc, "USDC receipts equal the drained cash legs"
        );
        assertEq(_outIn[0] + _outIn[1] + _outIn[2] + _outIn[3], _drainedOut, "OUT receipts equal the drained cash legs");
        assertEq(usdc.balanceOf(_who[1]), _usdc0[1], "FundStore paid out exactly what it received in USDC");
        assertEq(outToken.balanceOf(_who[1]), _out0[1], "and in OUT, other funds' balances untouched");
        assertEq(share.balanceOf(address(fundStore)), 0, "no units left queued");
        assertEq(share.totalSupply(), 499e18, "the master's 399 and the backers' kept 50 each remain");
    }

    function _gainThenLoss(
        uint _p1,
        uint _p2,
        bool _between
    ) internal returns (uint fee_, uint paid_, uint first_, uint firstFee_) {
        (address _a, uint _aKey) = _back("em-path", 0, 401e6);
        address _acct = _account(_a);
        address _owner = _account(master);
        _sell(_a, _aKey, 400e18);
        uint _owner0 = usdc.balanceOf(_owner);
        uint _acct0 = usdc.balanceOf(_acct);
        _drainAt(0, 200e18, _p1, _usd());
        if (_between) {
            vm.prank(makeAddr("em-stranger"));
            hub.claim(body, share, _acct);
        }
        first_ = usdc.balanceOf(_acct) - _acct0;
        firstFee_ = usdc.balanceOf(_owner) - _owner0;
        _drainAt(0, 200e18, _p2, _usd());
        hub.claim(body, share, _acct);
        fee_ = usdc.balanceOf(_owner) - _owner0;
        paid_ = usdc.balanceOf(_acct) - _acct0;
        _assertClosed(_acct, 1);
    }

    function test_performance_fee_is_path_independent_and_basis_first() public {
        _open();
        uint _snap = vm.snapshotState();

        (uint _feeBetween, uint _paidBetween, uint _first, uint _firstFee) = _gainThenLoss(1.5e12, 0.25e12, true);
        assertEq(_first, 299e6, "the stranger's claim paid the holder the whole gain drain");
        assertEq(_firstFee, 0, "charging nothing while 299 is still under the 401 basis");
        vm.revertToState(_snap);
        _snap = vm.snapshotState();
        uint _feeEnd;
        uint _paidEnd;
        (_feeEnd, _paidEnd, _first, _firstFee) = _gainThenLoss(1.5e12, 0.25e12, false);
        assertEq(_first + _firstFee, 0, "without a claim nothing moves before the loss drain");
        assertEq(_feeBetween, 0, "a gain drain claimed before a loss drain charges nothing on an exit that lost overall");
        assertEq(_feeEnd, 0, "and neither does one claim at the end");
        assertEq(_paidBetween, 348e6, "the holder keeps 299 + 49");
        assertEq(_paidEnd, 348e6);

        vm.revertToState(_snap);
        _snap = vm.snapshotState();
        (_feeBetween, _paidBetween, _first, _firstFee) = _gainThenLoss(3e12, 0.5e12, true);
        assertEq(_firstFee, 19.8e6, "the claim in between charges perfFee * (599 - 401), basis consumed first");
        assertEq(_first, 599e6 - 19.8e6);
        vm.revertToState(_snap);
        (_feeEnd, _paidEnd, _first, _firstFee) = _gainThenLoss(3e12, 0.5e12, false);
        assertEq(_first + _firstFee, 0);
        assertEq(_feeBetween, 29.7e6, "perfFee * (599 + 99 - 401) with a claim in between");
        assertEq(_feeEnd, _feeBetween, "equals the fee of a single claim at the end");
        assertEq(_paidBetween, 698e6 - 29.7e6);
        assertEq(_paidEnd, _paidBetween);
    }

    function _lossThenGain(
        bool _between
    ) internal returns (uint fee_, uint paid_, uint shortfall_) {
        (address _a, uint _aKey) = _back("em-carry", 0, 401e6);
        address _acct = _account(_a);
        address _owner = _account(master);
        uint _owner0 = usdc.balanceOf(_owner);
        uint _acct0 = usdc.balanceOf(_acct);
        _sell(_a, _aKey, 200e18);
        _drainAt(0, 200e18, 0.5e12, _usd());
        _assertQueue(1, 0);
        if (_between) hub.claim(body, share, _acct);
        _sell(_a, _aKey, 200e18);
        shortfall_ = fundStore.getPosition(body, _acct).shortfall;
        assertEq(usdc.balanceOf(_acct), _acct0 - 2 * FEE + 99e6, "the closed epoch paid its 99 before the next drain");
        assertEq(usdc.balanceOf(_owner), _owner0, "with no fee on a loss");
        _drainAt(0, 200e18, 2e12, _usd());
        hub.claim(body, share, _acct);
        fee_ = usdc.balanceOf(_owner) - _owner0;
        paid_ = usdc.balanceOf(_acct) + 2 * FEE - _acct0;
        assertEq(fundStore.getPosition(body, _acct).shortfall, 0, "the gain used up the carried shortfall");
        _assertClosed(_acct, 2);
    }

    function test_loss_then_gain_is_offset_by_the_shortfall_carry() public {
        _open();
        uint _snap = vm.snapshotState();
        (uint _feeBetween, uint _paidBetween, uint _carryBetween) = _lossThenGain(true);
        vm.revertToState(_snap);
        (uint _feeEnd, uint _paidEnd, uint _carryEnd) = _lossThenGain(false);
        assertEq(_carryBetween, 101.5e30, "the closed epoch leaves 200.5 - 99 of basis as shortfall");
        assertEq(_carryEnd, _carryBetween, "whether a claim or the next sell settles it");
        assertEq(_feeBetween, 9.7e6, "perfFee * (99 + 399 - 401), not perfFee * (399 - 200.5)");
        assertEq(_feeEnd, _feeBetween);
        assertEq(_paidBetween, 498e6 - 9.7e6);
        assertEq(_paidEnd, _paidBetween);
    }

    function test_master_retires_while_backers_queue_but_drains_last() public {
        _open();
        (address _a, uint _aKey) = _back("em-senior", 5000, 401e6);
        assertEq(fundStore.skinMap(body), 5000, "the backer's mandate sets the skin floor");
        address _acct = _account(_a);
        address _owner = _account(master);
        _sell(_a, _aKey, 200e18);

        (Fund.RedeemIntent memory _i, bytes memory _sig) = _redeemIntent(100e18, 50e18, 1e12, _usd(), FEE * USD);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__SkinBelowFloor.selector, 399e18, 799e18, 5000));
        hub.redeem(_i, _sig);

        (_i, _sig) = _redeemIntent(99e18, 200e18 + 1, 1e12, _usd(), FEE * USD);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__DrainExceedsQueue.selector, 200e18 + 1, 200e18));
        hub.redeem(_i, _sig);

        uint _owner0 = usdc.balanceOf(_owner);
        uint _store0 = usdc.balanceOf(address(fundStore));
        uint _acct0 = usdc.balanceOf(_acct);
        _drainAt(99e18, 50e18, 1e12, _usd());
        assertEq(fundStore.retiredMap(body), 99e18, "the master retires at the floor while a backer is queued");
        assertEq(share.balanceOf(body), 400e18);
        assertEq(share.balanceOf(address(fundStore)), 99e18 + 150e18, "the drain came out of the backer pool");
        assertEq(usdc.balanceOf(address(fundStore)), _store0 + 49e6, "and paid the pool's accrual");
        assertEq(usdc.balanceOf(_owner), _owner0, "not the master");
        _assertQueue(0, 200e18);

        (_i, _sig) = _redeemIntent(0, 150e18 + 1, 1e12, _usd(), FEE * USD);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__DrainExceedsQueue.selector, 150e18 + 1, 150e18));
        hub.redeem(_i, _sig);

        _sell(_a, _aKey, 150e18);
        _assertQueue(0, 400e18);
        _drainAt(0, 300e18, 1e12, _usd());
        _assertQueue(1, 0);
        assertEq(fundStore.retiredMap(body), 99e18, "the retired units wait until the pool is empty");
        assertEq(share.balanceOf(address(fundStore)), 99e18);

        (_i, _sig) = _redeemIntent(0, 99e18 + 1, 1e12, _usd(), FEE * USD);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__DrainExceedsQueue.selector, 99e18 + 1, 99e18));
        hub.redeem(_i, _sig);

        uint _storeBefore = usdc.balanceOf(address(fundStore));
        _drainAt(0, 99e18, 1e12, _usd());
        assertEq(usdc.balanceOf(_owner), _owner0 + 98e6, "the master's cash goes to the owner account net of the relay fee");
        assertEq(usdc.balanceOf(address(fundStore)), _storeBefore, "and never through the backer pool");
        assertEq(fundStore.retiredMap(body), 0);
        assertEq(fundStore.accruedMap(body, 1), 0, "the retired drain accrues nothing to backers");
        assertEq(fundStore.getEpochTokenList(body, 1).length, 0);
        _assertQueue(1, 0);

        hub.claim(body, share, _acct);
        assertEq(
            usdc.balanceOf(_acct), _acct0 + 49e6 + 299e6 - FEE, "the backer receives every drain of the pool, undiluted"
        );
        assertEq(usdc.balanceOf(address(fundStore)), _store0, "the store paid out all it received");
        _assertClosed(_acct, 1);
    }

    function test_drain_fee_is_capped_and_dust_queues_always_drain() public {
        _open();
        (address _a, uint _aKey) = _back("em-cap", 0, 401e6);
        address _acct = _account(_a);
        _sell(_a, _aKey, 400e18);

        uint _body0 = usdc.balanceOf(body);
        uint _relay0 = usdc.balanceOf(feeReceiver);
        uint _store0 = usdc.balanceOf(address(fundStore));
        (Fund.RedeemIntent memory _i, bytes memory _sig) = _redeemIntent(0, 100e18, 1e12, _usd(), 1_000_000e6 * USD);
        hub.redeem(_i, _sig);
        assertEq(usdc.balanceOf(body), _body0 - 100e6, "the drain moves its cash");
        assertEq(usdc.balanceOf(feeReceiver), _relay0 + 10e6, "a $1M header fee is charged only up to 10% of the cash");
        assertEq(usdc.balanceOf(address(fundStore)), _store0 + 90e6, "the backers keep the rest");
        assertEq(fundStore.accruedMap(body, 0), 2.25e59, "and accrue it as value");

        _drainAt(0, 300e18, 1e12, _usd());
        hub.claim(body, share, _acct);
        _assertQueue(1, 0);

        (address _b, uint _bKey) = _back("em-dust", 0, 201e6);
        address _bAcct = _account(_b);

        _sell(_b, _bKey, 1);
        _body0 = usdc.balanceOf(body);
        _relay0 = usdc.balanceOf(feeReceiver);
        _drainAt(0, 1, 1e12, _usd());
        _assertQueue(2, 0);
        assertEq(share.balanceOf(address(fundStore)), 0, "a one-unit queue drains in full");
        assertEq(usdc.balanceOf(body), _body0, "its cash rounds to nothing");
        assertEq(usdc.balanceOf(feeReceiver), _relay0, "so the relayer absorbs the whole fee");
        assertEq(fundStore.getEpochTokenList(body, 1).length, 0, "a zero accrual lists no token");

        _sell(_b, _bKey, 5e12);
        _body0 = usdc.balanceOf(body);
        _relay0 = usdc.balanceOf(feeReceiver);
        _store0 = usdc.balanceOf(address(fundStore));
        _drainAt(0, 5e12, 1e12, _usd());
        _assertQueue(3, 0);
        assertEq(usdc.balanceOf(body), _body0 - 5, "a five-wei queue drains in full");
        assertEq(usdc.balanceOf(feeReceiver), _relay0 + 1, "paying one wei of fee against a $1 header fee");
        assertEq(usdc.balanceOf(address(fundStore)), _store0 + 4);
        uint _bBefore = usdc.balanceOf(_bAcct);
        hub.claim(body, share, _bAcct);
        assertEq(usdc.balanceOf(_bAcct), _bBefore + 4, "and the backer claims it");
        assertEq(usdc.balanceOf(address(fundStore)), _store0);
    }

    function test_unreceivable_token_is_owed_and_blocks_nothing() public {
        _open();
        (address _a, uint _aKey) = _back("em-owed", 0, 401e6);
        address _acct = _account(_a);
        address _owner = _account(master);
        outToken.mint(body, 1e18);
        _sell(_a, _aKey, 200e18);
        _drainAt(0, 100e18, 2.01e12, _usd());
        _drainAt(0, 50e18, 4.02e12, _out());
        assertEq(usdc.balanceOf(address(fundStore)), 200e6);
        assertEq(outToken.balanceOf(address(fundStore)), 1e17);

        uint _acctUsdc0 = usdc.balanceOf(_acct);
        uint _acctOut0 = outToken.balanceOf(_acct);
        uint _ownerUsdc0 = usdc.balanceOf(_owner);
        uint _ownerOut0 = outToken.balanceOf(_owner);
        vm.mockCallRevert(address(usdc), abi.encodeWithSelector(IERC20.transfer.selector, _acct), "blocked");
        vm.mockCallRevert(address(usdc), abi.encodeWithSelector(IERC20.transfer.selector, _owner), "blocked");
        vm.mockCallRevert(address(outToken), abi.encodeWithSelector(IERC20.transfer.selector, _owner), "blocked");
        _sell(_a, _aKey, 50e18);
        assertEq(share.balanceOf(_acct), 150e18, "the sell went through");
        assertEq(usdc.balanceOf(_acct), _acctUsdc0 - FEE, "the blocked USDC payout did not reach the holder");
        assertEq(fundStore.owedMap(_acct, address(usdc)), 190.025e6, "it is owed instead: 200 less the 9.975 fee");
        assertEq(outToken.balanceOf(_acct), _acctOut0 + 9.50125e16, "OUT paid the holder past a blocked owner");
        assertEq(usdc.balanceOf(_owner), _ownerUsdc0, "the blocked USDC fee did not reach the owner");
        assertEq(fundStore.owedMap(_owner, address(usdc)), 9.975e6, "it is owed instead");
        assertEq(outToken.balanceOf(_owner), _ownerOut0, "nor did the blocked OUT fee");
        assertEq(fundStore.owedMap(_owner, address(outToken)), 4.9875e15);
        assertEq(usdc.balanceOf(address(fundStore)), 190.025e6 + 9.975e6, "the store holds exactly what is owed");
        assertEq(outToken.balanceOf(address(fundStore)), 4.9875e15);
        assertEq(
            fundStore.tokenCursorMap(body, _acct, 0, address(usdc)),
            fundStore.tokenAccruedMap(body, 0, address(usdc)),
            "the owed credit settles the cursor"
        );
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__NothingToClaim.selector, _acct));
        hub.claim(body, share, _acct);
        vm.expectRevert(
            abi.encodeWithSelector(Error.TransferUtils__TokenTransferError.selector, address(usdc), _acct, 190.025e6)
        );
        hub.payOwed(_acct, address(usdc));
        vm.clearMockedCalls();

        _assertQueue(0, 400e18);
        _drainAt(0, 100e18, 2e12, _usd());
        vm.mockCallRevert(address(usdc), abi.encodeWithSelector(IERC20.transfer.selector, _acct), "blocked");
        vm.mockCallRevert(address(usdc), abi.encodeWithSelector(IERC20.transfer.selector, _owner), "blocked");
        hub.claim(body, share, _acct);
        vm.clearMockedCalls();
        assertEq(usdc.balanceOf(_acct), _acctUsdc0 - FEE, "a claim with every payee blocked still settles");
        assertEq(fundStore.owedMap(_acct, address(usdc)), 190.025e6 + 184.1125e6, "a second block accumulates");
        assertEq(fundStore.owedMap(_owner, address(usdc)), 9.975e6 + 14.8875e6, "for the owner too");
        assertEq(usdc.balanceOf(address(fundStore)), 399e6, "the store holds both drains' net cash");

        hub.payOwed(_acct, address(usdc));
        hub.payOwed(_owner, address(outToken));
        hub.payOwed(_owner, address(usdc));
        assertEq(usdc.balanceOf(_acct), _acctUsdc0 - FEE + 184.1125e6 + 190.025e6, "payOwed delivers the holder's USDC");
        assertEq(outToken.balanceOf(_owner), _ownerOut0 + 4.9875e15, "and the owner's OUT fee");
        assertEq(usdc.balanceOf(_owner), _ownerUsdc0 + 9.975e6 + 14.8875e6, "and the owner's USDC fee");
        assertEq(fundStore.owedMap(_acct, address(usdc)), 0);
        assertEq(fundStore.owedMap(_owner, address(outToken)), 0);
        assertEq(fundStore.owedMap(_owner, address(usdc)), 0);
        assertEq(usdc.balanceOf(address(fundStore)), 0, "the store paid out all it received, no more");
        assertEq(outToken.balanceOf(address(fundStore)), 0);

        vm.expectRevert(abi.encodeWithSelector(Error.Fund__NothingToClaim.selector, _acct));
        hub.payOwed(_acct, address(usdc));
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__NothingToClaim.selector, _owner));
        hub.payOwed(_owner, address(outToken));
        _assertClosed(_acct, 1);
    }

    function test_native_drain_pays_backers_in_eth() public {
        _open();
        (address _a, uint _aKey) = _back("em-native", 0, 401e6);
        address _acct = _account(_a);
        address _owner = _account(master);
        vm.deal(body, 1 ether);
        _sell(_a, _aKey, 400e18);

        uint _relay0 = feeReceiver.balance;
        uint _acct0 = _acct.balance;
        uint _owner0 = _owner.balance;
        _drainAt(0, 400e18, 2e12, _eth());
        _assertQueue(1, 0);
        assertEq(body.balance, 1 ether - 4e17, "the body paid 800 of value at 2000 per ETH");
        assertEq(feeReceiver.balance, _relay0 + 5e14, "the relay fee in ETH");
        assertEq(address(fundStore).balance, 3.995e17, "the rest into the store");
        address[] memory _tokens = fundStore.getEpochTokenList(body, 0);
        assertEq(_tokens.length, 1);
        assertEq(_tokens[0], NATIVE_TOKEN, "the epoch lists native ETH");

        hub.claim(body, share, _acct);
        assertEq(_acct.balance, _acct0 + 3.796e17, "the backer claims ETH net of the performance fee");
        assertEq(_owner.balance, _owner0 + 1.99e16, "the owner's fee is 10% of 799 - 401 in ETH");
        assertEq(address(fundStore).balance, 0, "the store keeps nothing");
        _assertClosed(_acct, 1);
    }

    function test_exit_reverts_carry_their_arguments() public {
        _open();
        (address _a, uint _aKey) = _back("em-revert", 0, 401e6);
        address _acct = _account(_a);
        address _nobody = makeAddr("em-nobody");

        (Fund.RedeemIntent memory _i, bytes memory _sig) = _redeemIntent(0, 0, 1e12, _usd(), FEE * USD);
        vm.expectRevert(Error.Fund__ZeroDrain.selector);
        hub.redeem(_i, _sig);

        (_i, _sig) = _redeemIntent(0, 1, 1e12, _usd(), FEE * USD);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__DrainExceedsQueue.selector, 1, 0));
        hub.redeem(_i, _sig);

        (_i, _sig) = _redeemIntent(499e18 + 1, 1, 1e12, _usd(), FEE * USD);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__InsufficientUnits.selector, 499e18, 499e18 + 1));
        hub.redeem(_i, _sig);

        (Fund.SellIntent memory _s, bytes memory _sSig) = _sellIntent(_a, _aKey, 400e18 + 1);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__InsufficientUnits.selector, 400e18, 400e18 + 1));
        hub.sell(_s, _sSig);

        vm.expectRevert(abi.encodeWithSelector(Error.Fund__NothingToClaim.selector, _acct));
        hub.claim(body, share, _acct);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__NothingToClaim.selector, _nobody));
        hub.payOwed(_nobody, address(usdc));

        _sell(_a, _aKey, 400e18 - 1);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__NothingToClaim.selector, _acct));
        hub.claim(body, share, _acct);

        (_i, _sig) = _redeemIntent(0, 400e18, 1e12, _usd(), FEE * USD);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__DrainExceedsQueue.selector, 400e18, 400e18 - 1));
        hub.redeem(_i, _sig);

        uint _body0 = usdc.balanceOf(body);
        uint _relay0 = usdc.balanceOf(feeReceiver);
        uint _store0 = usdc.balanceOf(address(fundStore));
        _drainAt(0, 400e18 - 2, 1e12, _usd());
        assertEq(
            share.balanceOf(address(fundStore)), 400e12, "a partial drain is clamped to leave ceil(weight / 1e6) queued"
        );
        _assertQueue(0, 400e18 - 1);
        assertEq(usdc.balanceOf(body), _body0 - (400e6 - 401), "the cash is priced on the clamped units");
        assertEq(usdc.balanceOf(feeReceiver), _relay0 + 1e6);
        assertEq(usdc.balanceOf(address(fundStore)), _store0 + 400e6 - 401 - 1e6);
        (_i, _sig) = _redeemIntent(0, 1, 1e12, _usd(), FEE * USD);
        vm.expectRevert(abi.encodeWithSelector(Error.Fund__DrainLeavesDust.selector, 400e12, 400e12));
        hub.redeem(_i, _sig);

        _body0 = usdc.balanceOf(body);
        _relay0 = usdc.balanceOf(feeReceiver);
        _drainAt(0, 400e12, 1e12, _usd());
        _assertQueue(1, 0);
        assertEq(usdc.balanceOf(body), _body0 - 400, "the floor drains in full");
        assertEq(usdc.balanceOf(feeReceiver), _relay0 + 40, "at a capped fee");
        hub.claim(body, share, _acct);
        _assertClosed(_acct, 1);
    }

    function test_closed_epoch_settlement_writes_no_cursor() public {
        _open();
        (address _a, uint _aKey) = _back("em-cursor-a", 0, 401e6);
        (address _b, uint _bKey) = _back("em-cursor-b", 0, 201e6);
        address _aAcct = _account(_a);
        address _bAcct = _account(_b);
        address _owner = _account(master);
        outToken.mint(body, 1e18);

        _sell(_a, _aKey, 200e18);
        _drainAt(0, 100e18, 1e12, _usd());
        hub.claim(body, share, _aAcct);
        assertEq(fundStore.tokenAccruedMap(body, 0, address(usdc)), 4.95e35);
        assertEq(fundStore.tokenCursorMap(body, _aAcct, 0, address(usdc)), 4.95e35, "an open-epoch settle writes the cursor");

        _sell(_b, _bKey, 100e18);
        assertEq(fundStore.tokenCursorMap(body, _bAcct, 0, address(usdc)), 4.95e35, "a fresh sell starts at the accrual");
        _assertQueue(0, 400e18);

        _drainAt(0, 100e18, 2e12, _out());
        _drainAt(0, 100e18, 2e12, _usd());
        _assertQueue(1, 0);
        assertEq(fundStore.tokenAccruedMap(body, 0, address(usdc)), 9.925e35);
        assertEq(fundStore.tokenAccruedMap(body, 0, address(outToken)), 2.4875e44);

        uint[6] memory _before = [
            usdc.balanceOf(_aAcct),
            outToken.balanceOf(_aAcct),
            usdc.balanceOf(_bAcct),
            outToken.balanceOf(_bAcct),
            usdc.balanceOf(_owner),
            outToken.balanceOf(_owner)
        ];
        hub.claim(body, share, _aAcct);
        hub.claim(body, share, _bAcct);

        assertEq(fundStore.tokenCursorMap(body, _aAcct, 0, address(usdc)), 4.95e35, "a closed settle leaves the cursor");
        assertEq(fundStore.tokenCursorMap(body, _aAcct, 0, address(outToken)), 0, "and writes none it never had");
        assertEq(fundStore.tokenCursorMap(body, _bAcct, 0, address(usdc)), 4.95e35);
        assertEq(fundStore.tokenCursorMap(body, _bAcct, 0, address(outToken)), 0);

        assertEq(usdc.balanceOf(_aAcct), _before[0] + 99.5e6 - 4.875e6, "A: its USDC since the cursor, less the fee share");
        assertEq(outToken.balanceOf(_aAcct), _before[1] + 4.975e16 - 2.4375e15, "A: all its OUT, less the fee share");
        assertEq(usdc.balanceOf(_bAcct), _before[2] + 99.5e6 - 4.925e6);
        assertEq(outToken.balanceOf(_bAcct), _before[3] + 4.975e16 - 2.4625e15);
        assertEq(usdc.balanceOf(_owner), _before[4] + 4.875e6 + 4.925e6, "owner: 10% of each gain split by token");
        assertEq(outToken.balanceOf(_owner), _before[5] + 2.4375e15 + 2.4625e15);
        assertEq(usdc.balanceOf(address(fundStore)), 0, "the store paid out all it received");
        assertEq(outToken.balanceOf(address(fundStore)), 0);

        _assertClosed(_aAcct, 1);
        _assertClosed(_bAcct, 1);
    }
}
