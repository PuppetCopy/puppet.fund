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
import {IntentLib, RATE_PRECISION} from "../utils/IntentLib.sol";
import {UserAccount} from "./UserAccount.sol";
import {TransferUtils} from "../utils/TransferUtils.sol";
import {IAccount} from "../utils/interfaces/IAccount.sol";
import {AccountModule} from "./AccountModule.sol";
import {MandateStore} from "./MandateStore.sol";
import {EscrowStore} from "./EscrowStore.sol";
import {FundAccount} from "./FundAccount.sol";
import {FundStore} from "./FundStore.sol";
import {Register} from "./Register.sol";
import {GateConfig} from "../utils/GateConfig.sol";
import {NATIVE_TOKEN} from "../utils/Native.sol";
import {Share} from "./Share.sol";

uint constant VIRTUAL_UNITS = 1e12;
uint constant VIRTUAL_VALUE = 1e24;
uint constant ACCRUED_PRECISION = 1e48;
uint constant WEIGHT_RATIO_CAP = 1e6;

contract Fund is Access {
    struct Asset {
        uint chainId;
        address token;
        uint amount;
    }

    struct Position {
        uint chainId;
        bytes32 venue;
        bytes32 id;
        uint valueInUsd;
    }

    struct Valuation {
        uint value;
        Asset[] assetList;
        Position[] positionList;
    }

    struct Allocation {
        address puppet;
        AccountLib.Mandate mandate;
        uint amount;
    }

    struct Credit {
        uint chainId;
        address token;
        uint amount;
    }

    struct Price {
        address token;
        uint amount;
        uint value;
    }

    struct AllocateIntent {
        AccountLib.IntentHeader header;
        Share share;
        Valuation valuation;
        Price price;
        Credit credit;
        Allocation[] allocationList;
    }

    struct SellIntent {
        AccountLib.IntentHeader header;
        address master;
        Share share;
        uint units;
    }

    struct RedeemIntent {
        AccountLib.IntentHeader header;
        Share share;
        Valuation valuation;
        Price price;
        uint retire;
        uint drain;
    }

    AccountModule public immutable accountModule;
    MandateStore public immutable mandateStore;
    FundStore public immutable fundStore;
    EscrowStore public immutable escrowStore;
    Register public immutable registerModule;
    address public immutable shareImpl;

    constructor(
        address _authority,
        AccountModule _accountModule,
        MandateStore _mandateStore,
        FundStore _fundStore,
        EscrowStore _escrowStore,
        Register _register,
        address _shareImpl
    ) Access(_authority) {
        if (
            address(_accountModule) == address(0) || address(_mandateStore) == address(0)
                || address(_fundStore) == address(0) || address(_escrowStore) == address(0)
                || address(_register) == address(0) || _shareImpl == address(0)
        ) {
            revert Error.Gate__InvalidModule();
        }
        accountModule = _accountModule;
        mandateStore = _mandateStore;
        fundStore = _fundStore;
        escrowStore = _escrowStore;
        registerModule = _register;
        shareImpl = _shareImpl;
    }

    function allocate(
        AllocateIntent calldata _intent,
        bytes32 _structHash,
        bytes calldata _coSig,
        GateConfig calldata _config
    ) external auth {
        address _master = _intent.header.account;
        if (_intent.header.feeToken != address(0)) {
            revert Error.Intent__FeeTokenMismatch(_intent.header.feeToken, address(0));
        }
        Price calldata _price = _intent.price;
        if (_price.amount == 0 || _price.value == 0) revert Error.Balance__ZeroAmount();
        IntentLib.verifyRegistered(registerModule, _price.token);
        uint _len = _intent.allocationList.length;
        if (_len > 0 && _price.token == NATIVE_TOKEN) revert Error.Fund__NativeRowsUnsupported(_len);
        Share _share = _intent.share;
        uint _supply = _share.totalSupply();
        uint _masterUnits = _share.balanceOf(_master);
        uint _exposed = _supply - fundStore.retiredMap(_master);
        uint _skin = _exposed > _masterUnits ? fundStore.skinMap(_master) : 0;
        _supply += VIRTUAL_UNITS;
        uint _nav = _intent.valuation.value + VIRTUAL_VALUE;
        uint _masterLeg = _intent.credit.amount > 0 ? 1 : 0;
        if (_len + _masterLeg == 0) revert Error.Balance__ZeroAmount();
        uint _slice = _intent.header.fee / (_len + _masterLeg);

        uint _minted;
        uint _included;
        address _prev;
        for (uint _i; _i < _len; ++_i) {
            Allocation calldata _row = _intent.allocationList[_i];
            address _puppet = _row.puppet;
            if (uint160(_puppet) <= uint160(_prev)) revert Error.Fund__AllocationListNotSorted(_prev, _puppet);
            _prev = _puppet;
            uint _value = Math.mulDiv(_row.amount, _price.value, _price.amount);
            if (_slice * RATE_PRECISION >= _value * _config.maxRelayFeeBps) continue;
            AccountLib.Mandate calldata _mandate = _row.mandate;
            bytes32 _mandateDigest = AccountLib.mandateDigest(_puppet, _mandate);
            if (mandateStore.mandateMap(_puppet, _master) != _mandateDigest || _mandate.expiry <= block.timestamp) {
                continue;
            }
            FundStore.Holding memory _holding = fundStore.getHolding(_master, _puppet);
            if (_holding.allocatedAt > 0 && block.timestamp - _holding.allocatedAt < _mandate.cooldownPeriod) {
                revert Error.Mandate__Cooldown(_puppet, _holding.allocatedAt, _mandate.cooldownPeriod);
            }
            if (
                UserAccount(payable(_puppet)).withdrawRequestedAt() != 0
                    || (_holding.basis + _value) * RATE_PRECISION
                        > (Math.mulDiv(BalanceLib.balanceOf(_price.token, _puppet), _price.value, _price.amount)
                                + _holding.basis) * _mandate.allocationRate
                    || !TransferUtils.tryTransferFrom(
                        IERC20(_price.token), _puppet, _master, _row.amount, _config.transferGasLimit
                    )
            ) continue;
            ++_included;
            uint _units = Math.mulDiv(_value - _slice, _supply, _nav);
            _holding.basis += SafeCast.toUint192(_value);
            _holding.allocatedAt = uint64(block.timestamp);
            fundStore.setHolding(_master, _puppet, _holding);
            _share.mint(_puppet, _units);
            if (_mandate.skin > _skin) _skin = _mandate.skin;
            _minted += _units;
            accountModule.record(
                _puppet,
                _mandateDigest,
                abi.encode(msg.sig, _master, _row.amount, _value, _slice, _units, _holding),
                BalanceLib.list(_price.token, address(_share))
            );
        }
        uint _billed = Math.mulDiv(_slice * _included, _price.amount, _price.value);
        uint _masterBilled;
        uint _creditedTotal;
        if (_masterLeg > 0) {
            Credit calldata _row = _intent.credit;
            bool _local = _row.chainId == block.chainid;
            if (_local && _row.token != _price.token) revert Error.Fund__CreditTokenMismatch(_row.token, _price.token);
            uint _value = Math.mulDiv(_row.amount, _price.value, _price.amount);
            _masterBilled = Math.mulDiv(_slice, _price.amount, _price.value, Math.Rounding.Ceil);
            if (_row.amount <= _masterBilled) revert Error.Fund__FeeUnfunded(_row.amount, _masterBilled);
            if (_local) {
                address _parent = _ownerOf(_master);
                uint _fulfilled = escrowStore.fulfilledMap(_parent, _master, _row.token);
                _creditedTotal = _fulfilled + _row.amount;
                if (_creditedTotal > escrowStore.escrowedMap(_parent, _master, _row.token)) {
                    revert Error.Escrow__InvalidFulfil(_fulfilled, _creditedTotal);
                }
                escrowStore.setFulfilled(_parent, _master, _row.token, _creditedTotal);
                if (_masterBilled > 0) {
                    escrowStore.pay(_row.token, _config.feeReceiver, _masterBilled, _config.transferGasLimit);
                }
                escrowStore.pay(_row.token, _master, _row.amount - _masterBilled, _config.transferGasLimit);
            } else {
                _creditedTotal = fundStore.creditedMap(_master, _row.chainId, _row.token) + _row.amount;
                fundStore.setCredited(_master, _row.chainId, _row.token, _creditedTotal);
            }
            uint _units = Math.mulDiv(_value - _slice, _supply, _nav);
            _share.mint(_master, _units);
            _masterUnits += _units;
            _minted += _units;
        }
        if (_minted == 0) revert Error.Balance__ZeroAmount();
        if (_masterUnits * RATE_PRECISION < (_exposed + _minted) * _skin) {
            revert Error.Fund__SkinBelowFloor(_masterUnits, _exposed + _minted, _skin);
        }
        fundStore.setSkin(_master, _skin);

        IAccount.Call[] memory _legs = new IAccount.Call[](_billed > 0 ? 1 : 0);
        if (_billed > 0) _legs[0] = CallLib.pay(_price.token, _config.feeReceiver, _billed, _config.transferGasLimit);
        accountModule.dispatch(
            IAccount(_master),
            _config.attestor,
            _structHash,
            _coSig,
            abi.encode(
                msg.sig,
                _intent.valuation.value,
                _price,
                _intent.credit,
                _creditedTotal,
                _minted,
                _skin,
                _slice,
                _billed,
                _masterBilled
            ),
            _legs,
            BalanceLib.list(_price.token, address(_share))
        );
    }

    function redeem(
        RedeemIntent calldata _intent,
        bytes32 _structHash,
        bytes calldata _coSig,
        GateConfig calldata _config
    ) external auth {
        address _master = _intent.header.account;
        if (_intent.header.feeToken != address(0)) {
            revert Error.Intent__FeeTokenMismatch(_intent.header.feeToken, address(0));
        }
        Price calldata _price = _intent.price;
        if (_price.amount == 0 || _price.value == 0) revert Error.Balance__ZeroAmount();
        if (_intent.drain == 0) revert Error.Fund__ZeroDrain();
        Share _share = _intent.share;
        uint _supply = _share.totalSupply();
        uint _retired = fundStore.retiredMap(_master);
        if (_intent.retire > 0) {
            uint _masterUnits = _share.balanceOf(_master);
            if (_masterUnits < _intent.retire) revert Error.Fund__InsufficientUnits(_masterUnits, _intent.retire);
            uint _exposed = _supply - _retired - _intent.retire;
            uint _staying = _masterUnits - _intent.retire;
            if (_exposed > _staying) {
                uint _skin = fundStore.skinMap(_master);
                if (_staying * RATE_PRECISION < _exposed * _skin) {
                    revert Error.Fund__SkinBelowFloor(_staying, _exposed, _skin);
                }
            }
            _share.transferFrom(_master, address(fundStore), _intent.retire);
            _retired += _intent.retire;
        }
        FundStore.Queue memory _queue = fundStore.getQueue(_master);
        uint _pool = _share.balanceOf(address(fundStore)) - _retired;
        bool _fromPool = _pool > 0;
        if (_intent.drain > (_fromPool ? _pool : _retired)) {
            revert Error.Fund__DrainExceedsQueue(_intent.drain, _fromPool ? _pool : _retired);
        }

        uint _nav = _intent.valuation.value + VIRTUAL_VALUE;
        _supply += VIRTUAL_UNITS;
        uint _drained = _intent.drain;
        {
            uint _fundBalance = BalanceLib.balanceOf(_price.token, _master);
            uint _gross = Math.mulDiv(Math.mulDiv(_drained, _nav, _supply), _price.amount, _price.value);
            if (_gross > _fundBalance) {
                _drained = Math.mulDiv(_drained, _fundBalance, _gross);
                if (_drained == 0) revert Error.Balance__InsufficientFund(_price.token, _fundBalance, _gross);
            }
        }
        if (_fromPool && _drained < _pool) {
            uint _floor = Math.ceilDiv(_queue.weight, WEIGHT_RATIO_CAP);
            if (_pool <= _floor) revert Error.Fund__DrainLeavesDust(_pool, _floor);
            _drained = Math.min(_drained, _pool - _floor);
        }
        uint _cashValue = Math.mulDiv(_drained, _nav, _supply);
        uint _feeValue = Math.min(_intent.header.fee, _cashValue * _config.maxRelayFeeBps / RATE_PRECISION);
        uint _cash = Math.mulDiv(_cashValue, _price.amount, _price.value);
        uint _billed = Math.min(Math.mulDiv(_feeValue, _price.amount, _price.value, Math.Rounding.Ceil), _cash);
        uint _net = _cash - _billed;
        _share.burn(address(fundStore), _drained);

        uint _accrued;
        uint _tokenAccrued;
        address _owner;
        if (_fromPool) {
            _accrued = fundStore.accruedMap(_master, _queue.epoch)
                + Math.mulDiv(_cashValue - _feeValue, ACCRUED_PRECISION, _queue.weight);
            fundStore.setAccrued(_master, _queue.epoch, _accrued);
            _tokenAccrued = fundStore.tokenAccruedMap(_master, _queue.epoch, _price.token);
            uint _increment = Math.mulDiv(_net, ACCRUED_PRECISION, _queue.weight);
            if (_increment > 0) {
                if (_tokenAccrued == 0) fundStore.pushEpochToken(_master, _queue.epoch, _price.token);
                _tokenAccrued += _increment;
                fundStore.setTokenAccrued(_master, _queue.epoch, _price.token, _tokenAccrued);
            }
            if (_drained == _pool) _queue = FundStore.Queue({epoch: _queue.epoch + 1, weight: 0});
            fundStore.setQueue(_master, _queue);
        } else {
            _retired -= _drained;
            _owner = _ownerOf(_master);
        }
        fundStore.setRetired(_master, _retired);

        IAccount.Call[] memory _legs = new IAccount.Call[](_billed > 0 ? 2 : 1);
        _legs[0] = CallLib.pay(_price.token, _fromPool ? address(fundStore) : _owner, _net, _config.transferGasLimit);
        if (_billed > 0) _legs[1] = CallLib.pay(_price.token, _config.feeReceiver, _billed, _config.transferGasLimit);
        bytes32 _digest = accountModule.dispatch(
            IAccount(_master),
            _config.attestor,
            _structHash,
            _coSig,
            abi.encode(
                msg.sig,
                _intent.valuation.value,
                _price,
                _intent.retire,
                _fromPool,
                _drained,
                _cashValue,
                _feeValue,
                _queue,
                _retired,
                _accrued,
                _tokenAccrued
            ),
            _legs,
            BalanceLib.list(_price.token, address(_share))
        );
        if (!_fromPool) {
            accountModule.record(
                _owner,
                _digest,
                abi.encode(msg.sig, _master, _price.token, _net),
                BalanceLib.list(_price.token)
            );
        }
    }

    function sell(
        SellIntent calldata _intent,
        bytes32 _structHash,
        bytes calldata _coSig,
        GateConfig calldata _config
    ) external auth {
        address _puppet = _intent.header.account;
        address _master = _intent.master;
        bytes32 _digest = AccountLib.intentDigest(_puppet, _intent.header.nonce, _structHash);
        if (_intent.units == 0) revert Error.Balance__ZeroAmount();
        Share _share = _intent.share;
        uint _held = _share.balanceOf(_puppet);
        if (_held < _intent.units) revert Error.Fund__InsufficientUnits(_held, _intent.units);
        FundStore.Holding memory _holding = fundStore.getHolding(_master, _puppet);
        uint _basis = Math.mulDiv(_holding.basis, _intent.units, _held);
        _holding.basis -= uint192(_basis);
        fundStore.setHolding(_master, _puppet, _holding);

        FundStore.Queue memory _queue = fundStore.getQueue(_master);
        FundStore.Position memory _position = fundStore.getPosition(_master, _puppet);
        bool _fresh = _position.weight == 0 || _position.epoch != _queue.epoch;
        (uint _payoutValue, uint _feeValue, address[] memory _paidList) =
            _settle(_master, _puppet, _queue, _position, _share, _config.transferGasLimit);
        if (_fresh) {
            address[] memory _currentList = fundStore.getEpochTokenList(_master, _queue.epoch);
            for (uint _i; _i < _currentList.length; ++_i) {
                fundStore.setTokenCursor(
                    _master,
                    _puppet,
                    _queue.epoch,
                    _currentList[_i],
                    fundStore.tokenAccruedMap(_master, _queue.epoch, _currentList[_i])
                );
            }
        }
        if (_feeValue > 0) {
            accountModule.record(
                _ownerOf(_master), _digest, abi.encode(msg.sig, _master, _puppet, _feeValue), _paidList
            );
        }
        uint _pool = _share.balanceOf(address(fundStore)) - fundStore.retiredMap(_master);
        uint _added = _queue.weight == 0 ? _intent.units : Math.mulDiv(_intent.units, _queue.weight, _pool);
        _queue.weight += _added;
        _position.weight += _added;
        _position.basis += _basis;
        _share.transferFrom(_puppet, address(fundStore), _intent.units);
        fundStore.setQueue(_master, _queue);
        fundStore.setPosition(_master, _puppet, _position);
        accountModule.record(
            _master, _digest, abi.encode(msg.sig, _puppet, _queue, _pool + _intent.units), new address[](0)
        );

        bytes memory _executionData = abi.encode(
            msg.sig,
            _master,
            _intent.units,
            _basis,
            _payoutValue,
            _feeValue,
            _holding,
            _position,
            _intent.header.feeToken,
            _intent.header.fee
        );
        uint _listed = _paidList.length;
        bool _feeListed;
        for (uint _i; _i < _listed; ++_i) {
            if (_paidList[_i] == _intent.header.feeToken) _feeListed = true;
        }
        address[] memory _tokenList = new address[](_listed + (_feeListed ? 1 : 2));
        for (uint _i; _i < _listed; ++_i) {
            _tokenList[_i] = _paidList[_i];
        }
        _tokenList[_listed] = address(_share);
        if (!_feeListed) _tokenList[_listed + 1] = _intent.header.feeToken;
        IAccount.Call[] memory _legs = new IAccount.Call[](1);
        _legs[0] = CallLib.pay(_intent.header.feeToken, _config.feeReceiver, _intent.header.fee, _config.transferGasLimit);
        accountModule.dispatch(IAccount(_puppet), _config.attestor, _structHash, _coSig, _executionData, _legs, _tokenList);
    }

    function claim(
        address _master,
        Share _share,
        address _holder,
        GateConfig calldata _config
    ) external auth {
        FundStore.Queue memory _queue = fundStore.getQueue(_master);
        FundStore.Position memory _position = fundStore.getPosition(_master, _holder);
        (uint _payoutValue, uint _feeValue, address[] memory _paidList) =
            _settle(_master, _holder, _queue, _position, _share, _config.transferGasLimit);
        if (_payoutValue == 0) revert Error.Fund__NothingToClaim(_holder);
        if (_feeValue > 0) {
            accountModule.record(
                _ownerOf(_master), bytes32(0), abi.encode(msg.sig, _master, _holder, _feeValue), _paidList
            );
        }
        fundStore.setPosition(_master, _holder, _position);
        accountModule.record(
            _holder, bytes32(0), abi.encode(msg.sig, _master, _payoutValue, _feeValue, _position), _paidList
        );
    }

    function _settle(
        address _master,
        address _holder,
        FundStore.Queue memory _queue,
        FundStore.Position memory _position,
        Share _share,
        uint _gasLimit
    ) internal returns (uint payoutValue_, uint feeValue_, address[] memory paidList_) {
        uint _weight = _position.weight;
        uint _epoch = _position.epoch;
        if (_weight > 0) {
            bool _closed = _epoch < _queue.epoch;
            payoutValue_ =
                Math.mulDiv(_weight, fundStore.accruedMap(_master, _epoch) - _position.cursor, ACCRUED_PRECISION);
            uint _consumed = Math.min(payoutValue_, _position.basis);
            _position.basis -= _consumed;
            uint _gain = payoutValue_ - _consumed;
            if (_closed) {
                _position.shortfall += _position.basis;
                _position.basis = 0;
                _position.weight = 0;
            }
            uint _recovered = Math.min(_gain, _position.shortfall);
            _position.shortfall -= _recovered;
            if (_gain > _recovered) {
                feeValue_ = Math.mulDiv(_gain - _recovered, _share.performanceFee(), RATE_PRECISION);
            }
            paidList_ = fundStore.getEpochTokenList(_master, _epoch);
            address _owner = feeValue_ > 0 ? _ownerOf(_master) : address(0);
            for (uint _i; _i < paidList_.length; ++_i) {
                address _token = paidList_[_i];
                uint _accrued = fundStore.tokenAccruedMap(_master, _epoch, _token);
                uint _amount = Math.mulDiv(
                    _weight, _accrued - fundStore.tokenCursorMap(_master, _holder, _epoch, _token), ACCRUED_PRECISION
                );
                if (_position.weight != 0) fundStore.setTokenCursor(_master, _holder, _epoch, _token, _accrued);
                uint _fee = payoutValue_ == 0 ? 0 : Math.mulDiv(_amount, feeValue_, payoutValue_);
                if (_amount > _fee) {
                    try fundStore.pay(_token, _holder, _amount - _fee, _gasLimit) {}
                    catch {
                        fundStore.setOwed(_holder, _token, fundStore.owedMap(_holder, _token) + _amount - _fee);
                    }
                }
                if (_fee > 0) {
                    try fundStore.pay(_token, _owner, _fee, _gasLimit) {}
                    catch {
                        fundStore.setOwed(_owner, _token, fundStore.owedMap(_owner, _token) + _fee);
                    }
                }
            }
        }
        _position.epoch = _queue.epoch;
        _position.cursor = fundStore.accruedMap(_master, _queue.epoch);
    }

    function _ownerOf(
        address _master
    ) internal view returns (address) {
        return FundAccount(payable(_master)).parent();
    }
}
