// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {Access} from "../utils/auth/Access.sol";
import {AccountLib} from "../utils/AccountLib.sol";
import {BalanceLib} from "../utils/BalanceLib.sol";
import {CallLib} from "../utils/CallLib.sol";
import {Error} from "../utils/Error.sol";
import {RATE_PRECISION} from "../utils/IntentLib.sol";
import {IAccount} from "../utils/interfaces/IAccount.sol";
import {IWNT} from "../utils/interfaces/IWNT.sol";
import {NATIVE_TOKEN} from "../utils/Native.sol";
import {AccountModule} from "./AccountModule.sol";
import {Fund, PRICE_PRECISION, VIRTUAL_SHARES, VIRTUAL_VALUE} from "./Fund.sol";
import {FundAccount} from "./FundAccount.sol";
import {FundStore, isOpen} from "./FundStore.sol";
import {GateConfig} from "../utils/GateConfig.sol";
import {ShareToken} from "./ShareToken.sol";

contract Redeem is Access {
    struct SellIntent {
        AccountLib.IntentHeader header;
        ShareToken shareToken;
        uint shares;
    }

    struct RedeemIntent {
        AccountLib.IntentHeader header;
        ShareToken shareToken;
        Fund.Valuation valuation;
        address token;
        uint fraction;
        uint join;
    }

    AccountModule public immutable accountModule;
    FundStore public immutable fundStore;
    address public immutable wnt;
    uint public immutable protocolFeeShare;
    address public immutable protocolFeeReceiver;

    constructor(
        address _authority,
        AccountModule _accountModule,
        FundStore _fundStore,
        address _wnt,
        uint _protocolFeeShare,
        address _protocolFeeReceiver
    ) Access(_authority) {
        if (
            address(_accountModule) == address(0) || address(_fundStore) == address(0) || _wnt == address(0)
                || _protocolFeeReceiver == address(0)
        ) {
            revert Error.Gate__InvalidModule();
        }
        if (_protocolFeeShare > RATE_PRECISION) revert Error.Gate__InvalidPerformanceFee(_protocolFeeShare);
        accountModule = _accountModule;
        fundStore = _fundStore;
        wnt = _wnt;
        protocolFeeShare = _protocolFeeShare;
        protocolFeeReceiver = _protocolFeeReceiver;
    }

    function redeem(
        RedeemIntent calldata _intent,
        bytes32 _structHash,
        uint _valuation,
        Fund.Price calldata _price,
        bytes calldata _coSig,
        GateConfig calldata _config
    ) external auth {
        address _master = _intent.header.account;
        address _token = _intent.token;
        if (_intent.header.feeToken != _token) revert Error.Intent__FeeTokenMismatch(_intent.header.feeToken, _token);
        bool _wrappable = _token == wnt;
        Fund.Price memory _rate = _wrappable ? Fund.Price({amount: 1, value: 1}) : _price;
        if (_rate.amount == 0 || _rate.value == 0) revert Error.Redeem__TokenUnpriced(_token);
        FundStore.Redemption memory _redemption = fundStore.getRedemption(_master);
        if (isOpen(_redemption)) revert Error.Redeem__Open(_redemption.id);
        ShareToken _shareToken = _intent.shareToken;
        uint _supply = _shareToken.totalSupply();
        uint _masterShares = _shareToken.balanceOf(_master);
        uint _queued = _redemption.queued;
        uint _active = _supply - _masterShares - _queued;
        uint _fraction = _intent.fraction;
        if (_fraction > RATE_PRECISION || (_fraction > 0 && _intent.join > 0)) {
            revert Error.Redeem__InvalidMode(_fraction, _intent.join);
        }
        if (_intent.join > _masterShares) revert Error.Fund__InsufficientShares(_masterShares, _intent.join);
        if (_intent.join * (_active + _queued) > _masterShares * _queued) {
            revert Error.Redeem__JoinAboveSymmetry(_intent.join, Math.mulDiv(_masterShares, _queued, _active + _queued));
        }
        uint _masterPart = _fraction > 0 ? Math.mulDiv(_masterShares, _fraction, RATE_PRECISION) : _intent.join;
        uint _owed = _queued * RATE_PRECISION + _active * _fraction;
        if (_owed + _masterPart == 0) revert Error.Balance__ZeroAmount();
        uint _held = BalanceLib.balanceOf(_token, _master);
        uint _cash = _wrappable ? _held + _master.balance : _held;
        bool _full = _owed + _masterPart * RATE_PRECISION == _supply * RATE_PRECISION;
        uint _worth = Math.mulDiv(_valuation, _rate.amount, _rate.value);
        if (_full && _worth > _cash) revert Error.Balance__InsufficientFund(_token, _cash, _worth);
        uint _nav = _full ? _cash : Math.mulDiv(_valuation + VIRTUAL_VALUE, _rate.amount, _rate.value);
        uint _base = _full ? _supply : _supply + VIRTUAL_SHARES;
        uint _pot = Math.mulDiv(_owed, _nav, _base * RATE_PRECISION);
        uint _masterPay = _full ? _cash - _pot : Math.mulDiv(_masterPart, _nav, _base);
        if (_pot + _masterPay > _cash) revert Error.Balance__InsufficientFund(_token, _cash, _pot + _masterPay);
        if (_pot + _masterPay < _intent.header.fee) revert Error.Redeem__Dust(_pot + _masterPay, _intent.header.fee);
        if (!_full && _masterPart > 0 && _owed > 0 && _pot <= _intent.header.fee) {
            revert Error.Redeem__Dust(_pot, _intent.header.fee);
        }

        _redemption = FundStore.Redemption({
            id: _redemption.id + 1,
            fraction: SafeCast.toUint32(_fraction),
            fee: SafeCast.toUint64(_intent.header.fee),
            masterPay: SafeCast.toUint96(_masterPay),
            queued: SafeCast.toUint128(_queued),
            owedLeft: SafeCast.toUint128(_owed),
            potLeft: SafeCast.toUint96(_pot),
            token: _token,
            price: Math.mulDiv(_full ? Math.mulDiv(_cash, _rate.value, _rate.amount) : _valuation + VIRTUAL_VALUE, PRICE_PRECISION, _base)
        });
        fundStore.setRedemption(_master, _redemption);

        IAccount.Call[] memory _legs = new IAccount.Call[](4);
        uint _n;
        if (_wrappable && _pot + _masterPay > _held) {
            _legs[_n++] = IAccount.Call({
                target: wnt, value: _pot + _masterPay - _held, gasLimit: 0, callData: abi.encodeCall(IWNT.deposit, ())
            });
        }
        if (_masterPart > 0) {
            _legs[_n++] = IAccount.Call({
                target: address(_shareToken),
                value: 0,
                gasLimit: 0,
                callData: abi.encodeCall(ShareToken.burn, (_master, _masterPart))
            });
        }
        _legs[_n++] = IAccount.Call({
            target: address(_shareToken),
            value: 0,
            gasLimit: 0,
            callData: abi.encodeCall(
                ShareToken.allowBurn, (_queued + Math.mulDiv(_active, _fraction, RATE_PRECISION))
            )
        });
        _legs[_n++] = CallLib.pay(_token, address(fundStore), _pot + _masterPay, _config.transferGasLimit);
        assembly ("memory-safe") {
            mstore(_legs, _n)
        }
        accountModule.dispatch(
            IAccount(_master),
            _config.attestor,
            _structHash,
            _intent.header.deadline,
            _coSig,
            abi.encode(
                msg.sig,
                _valuation,
                _intent.join,
                _active,
                _masterShares,
                _cash,
                _redemption,
                _rate
            ),
            _legs,
            _wrappable ? BalanceLib.list(_token, NATIVE_TOKEN, address(_shareToken)) : BalanceLib.list(_token, address(_shareToken))
        );
        fundStore.book(_master, _token, _pot + _masterPay);
    }

    function redeemCohort(
        address _master,
        ShareToken _shareToken,
        address[] calldata _holderList,
        GateConfig calldata _config
    ) external auth {
        FundStore.Redemption memory _redemption = fundStore.getRedemption(_master);
        address[] memory _tokenList = BalanceLib.list(address(_shareToken), _redemption.token);
        uint _performanceFee = _shareToken.performanceFee();
        uint _owed = _redemption.owedLeft;
        uint _fees;
        uint _protocolFees;
        uint _cut;
        for (uint _i; _i < _holderList.length && _redemption.potLeft > _redemption.fee; ++_i) {
            address _holder = _holderList[_i];
            if (_holder == _master) revert Error.Fund__NotHolder(_holder);
            FundStore.Holding memory _holding = fundStore.getHolding(_master, _holder);
            if (_holding.redeemedAt == _redemption.id) continue;
            uint _queued = _holding.queued;
            uint _free = _shareToken.balanceOf(_holder) - _queued;
            uint _claim = _queued * RATE_PRECISION + _free * _redemption.fraction;
            if (_claim == 0) continue;
            uint _payout = Math.mulDiv(_redemption.potLeft, _claim, _redemption.owedLeft);
            uint _profitFee = _holding.cost < _redemption.price
                ? Math.mulDiv(
                    _payout, _performanceFee * (_redemption.price - _holding.cost), _redemption.price * RATE_PRECISION
                )
                : 0;
            uint _burned;
            uint _protocolCut;
            bool _refused;
            _redemption.potLeft -= SafeCast.toUint96(_payout);
            _redemption.owedLeft -= SafeCast.toUint128(_claim);
            if (_payout - _profitFee > _redemption.fee) {
                uint _net = _payout - _profitFee - _redemption.fee;
                if (gasleft() < 2 * _config.transferGasLimit) revert Error.Redeem__OutOfGas(gasleft(), 2 * _config.transferGasLimit);
                try fundStore.pay(_master, _redemption.token, _holder, _net, _config.transferGasLimit) {}
                catch (bytes memory _reason) {
                    if (
                        bytes4(_reason) != Error.TransferUtils__TokenTransferError.selector
                            || IERC20(_redemption.token).balanceOf(address(fundStore)) < _net
                    ) {
                        assembly ("memory-safe") {
                            revert(add(_reason, 32), mload(_reason))
                        }
                    }
                    _refused = true;
                }
            }
            if (_payout - _profitFee > _redemption.fee && !_refused) {
                _burned = Math.mulDiv(_free, _redemption.fraction, RATE_PRECISION);
                if (_queued + _burned > 0) _shareToken.burn(_holder, _queued + _burned);
                _protocolCut = Math.mulDiv(_profitFee, protocolFeeShare, RATE_PRECISION);
                _redemption.queued -= SafeCast.toUint128(_queued);
                _redemption.masterPay += SafeCast.toUint96(_profitFee - _protocolCut);
                _holding.queued = 0;
                _protocolFees += _protocolCut;
                _fees += _redemption.fee;
            } else {
                _cut += _payout;
                _queued = 0;
                _profitFee = 0;
            }
            _holding.redeemedAt = SafeCast.toUint40(_redemption.id);
            fundStore.setHolding(_master, _holder, _holding);
            accountModule.record(
                _holder,
                bytes32(0),
                abi.encode(msg.sig, _master, _queued, _burned, _payout, _profitFee, _protocolCut, _redemption, _refused),
                _tokenList
            );
        }
        if (_redemption.owedLeft > 0 && _redemption.potLeft <= _redemption.fee) {
            _cut += _redemption.potLeft;
            _redemption.owedLeft = 0;
            _redemption.potLeft = 0;
        }
        {
            bool _closing = _redemption.owedLeft == 0 && (_owed > 0 || _redemption.masterPay > 0);
            uint _payout = _closing ? _redemption.masterPay : 0;
            uint _masterFee = Math.min(_payout, _redemption.fee);
            if (_closing) {
                _fees += _masterFee;
                _redemption.masterPay = 0;
            }
            fundStore.setRedemption(_master, _redemption);
            if (_payout > _masterFee) {
                address _owner = FundAccount(payable(_master)).parent();
                uint _paid = _payout - _masterFee;
                fundStore.pay(_master, _redemption.token, _owner, _paid, _config.transferGasLimit);
                accountModule.record(
                    _owner, bytes32(0), abi.encode(msg.sig, _master, _redemption.token, _paid), BalanceLib.list(_redemption.token)
                );
            }
            if (_cut > 0) fundStore.pay(_master, _redemption.token, _master, _cut, _config.transferGasLimit);
            if (_closing || _cut > 0) {
                uint _unburned = _closing ? _shareToken.pendingBurn() : 0;
                accountModule.record(
                    _master, bytes32(0), abi.encode(msg.sig, _payout, _cut, _redemption, _unburned), _tokenList
                );
            }
        }
        if (_fees > 0) fundStore.pay(_master, _redemption.token, _config.feeReceiver, _fees, _config.transferGasLimit);
        if (_protocolFees > 0) {
            fundStore.pay(_master, _redemption.token, protocolFeeReceiver, _protocolFees, _config.transferGasLimit);
        }
    }

    function sell(
        address _master,
        SellIntent calldata _intent,
        bytes32 _structHash,
        bytes calldata _coSig,
        GateConfig calldata _config
    ) external auth {
        address _puppet = _intent.header.account;
        if (_intent.shares == 0) revert Error.Balance__ZeroAmount();
        ShareToken _shareToken = _intent.shareToken;
        FundStore.Redemption memory _redemption = fundStore.getRedemption(_master);
        FundStore.Holding memory _holding = fundStore.getHolding(_master, _puppet);
        uint _balance = _shareToken.balanceOf(_puppet);
        uint _queued;
        uint _burned;
        uint _payout;
        uint _profitFee;
        uint _protocolCut;
        if (_redemption.owedLeft > 0 && _holding.redeemedAt != _redemption.id) {
            _queued = _holding.queued;
            _burned = Math.mulDiv(_balance - _queued, _redemption.fraction, RATE_PRECISION);
            uint _claim = _queued * RATE_PRECISION + (_balance - _queued) * _redemption.fraction;
            if (_queued + _burned > 0) _shareToken.burn(_puppet, _queued + _burned);
            _balance -= _queued + _burned;
            _payout = Math.mulDiv(_redemption.potLeft, _claim, _redemption.owedLeft);
            if (_holding.cost < _redemption.price) {
                _profitFee = Math.mulDiv(
                    _payout,
                    _shareToken.performanceFee() * (_redemption.price - _holding.cost),
                    _redemption.price * RATE_PRECISION
                );
                _protocolCut = Math.mulDiv(_profitFee, protocolFeeShare, RATE_PRECISION);
            }
            _redemption.potLeft -= SafeCast.toUint96(_payout);
            _redemption.owedLeft -= SafeCast.toUint128(_claim);
            _redemption.queued -= SafeCast.toUint128(_queued);
            _redemption.masterPay += SafeCast.toUint96(_profitFee - _protocolCut);
            _holding.queued = 0;
            _holding.redeemedAt = SafeCast.toUint40(_redemption.id);
        }
        if (_balance - _holding.queued < _intent.shares) {
            revert Error.Fund__InsufficientShares(_balance - _holding.queued, _intent.shares);
        }
        _holding.queued += SafeCast.toUint96(_intent.shares);
        _redemption.queued += SafeCast.toUint128(_intent.shares);
        fundStore.setHolding(_master, _puppet, _holding);
        fundStore.setRedemption(_master, _redemption);
        if (_payout > _profitFee) {
            fundStore.pay(_master, _redemption.token, _puppet, _payout - _profitFee, _config.transferGasLimit);
        }
        if (_protocolCut > 0) {
            fundStore.pay(_master, _redemption.token, protocolFeeReceiver, _protocolCut, _config.transferGasLimit);
        }

        IAccount.Call[] memory _legs = new IAccount.Call[](1);
        _legs[0] = CallLib.pay(_intent.header.feeToken, _config.feeReceiver, _intent.header.fee, _config.transferGasLimit);
        accountModule.dispatch(
            IAccount(_puppet),
            _config.attestor,
            _structHash,
            _intent.header.deadline,
            _coSig,
            abi.encode(
                msg.sig,
                _master,
                _intent.shares,
                _holding,
                _redemption,
                _queued,
                _burned,
                _payout,
                _profitFee,
                _protocolCut,
                _intent.header.feeToken,
                _intent.header.fee
            ),
            _legs,
            _payout > 0
                ? BalanceLib.list(address(_shareToken), _intent.header.feeToken, _redemption.token)
                : BalanceLib.list(address(_shareToken), _intent.header.feeToken)
        );
    }
}
