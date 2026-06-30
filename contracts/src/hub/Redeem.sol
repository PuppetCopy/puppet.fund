// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IAccount} from "../utils/interfaces/IAccount.sol";
import {AccountLib} from "../utils/AccountLib.sol";
import {Account} from "../core/Account.sol";
import {Issue} from "./Issue.sol";
import {Access} from "../utils/auth/Access.sol";
import {CallLib} from "../utils/CallLib.sol";
import {SignLib} from "../utils/SignLib.sol";
import {Error} from "../utils/Error.sol";
import {IAuthority} from "../utils/interfaces/IAuthority.sol";
import {Precision} from "../utils/Precision.sol";
import {RedeemStore} from "./store/RedeemStore.sol";
import {FundAccountLib} from "../utils/FundAccountLib.sol";
import {ShareToken} from "./ShareToken.sol";

bytes32 constant SELL_INTENT_TYPEHASH = keccak256(
    "SellIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,FundAccountInitParams fundParams,uint256 sharesOut)AccountInitParams(address user,address signer)FundAccountInitParams(address master,address baseToken,bytes32 name)"
);

bytes32 constant CLAIM_INTENT_TYPEHASH = keccak256(
    "ClaimIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,FundAccountInitParams fundParams)AccountInitParams(address user,address signer)FundAccountInitParams(address master,address baseToken,bytes32 name)"
);

bytes32 constant REDEEM_INTENT_TYPEHASH = keccak256(
    "RedeemIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,FundAccountInitParams fundParams,uint256 sharesOut,uint256 assetsOut,uint256 acceptableNetAssetValue)AccountInitParams(address user,address signer)FundAccountInitParams(address master,address baseToken,bytes32 name)"
);

bytes32 constant LIQUIDATE_INTENT_TYPEHASH = keccak256(
    "LiquidateIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,FundAccountInitParams fundParams,uint256 acceptableNetAssetValue)AccountInitParams(address user,address signer)FundAccountInitParams(address master,address baseToken,bytes32 name)"
);

uint constant WEIGHT_RATIO_CAP = 1e6;

contract Redeem is Access {
    struct SellIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        FundAccountLib.FundAccountInitParams fundParams;
        uint sharesOut;
    }

    struct ClaimIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        FundAccountLib.FundAccountInitParams fundParams;
    }

    struct RedeemIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        FundAccountLib.FundAccountInitParams fundParams;
        uint sharesOut;
        uint assetsOut;
        uint acceptableNetAssetValue;
    }

    struct LiquidateIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        FundAccountLib.FundAccountInitParams fundParams;
        uint acceptableNetAssetValue;
    }

    constructor(
        IAuthority _authority
    ) Access(_authority) {}

    function getClaimable(
        RedeemStore _store,
        address _fund,
        address _holder
    ) external view returns (uint) {
        return _settle(_store, _fund, _store.getPosition(_fund, _holder), _store.getPool(_fund));
    }

    function getQueuedShares(
        RedeemStore _store,
        ShareToken _shareToken,
        address _holder
    ) external view returns (uint) {
        address _fund = _shareToken.getFund();
        RedeemStore.Pool memory _pool = _store.getPool(_fund);
        RedeemStore.Position memory _position = _store.getPosition(_fund, _holder);
        if (_pool.weight == 0 || _position.epoch < _pool.epoch) return 0;
        return Math.mulDiv(_position.weight, _shareToken.balanceOf(address(_store)), _pool.weight);
    }

    function sell(
        SellIntent calldata _intent,
        IAccount _holder,
        RedeemStore _store,
        Account _accountGate,
        Issue _shareGate,
        address _baseToken,
        address _fund,
        bytes32 _digest,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        address _attestor,
        uint _transferGasLimit,
        address _feeReceiver,
        uint _actualRelayFee
    ) external auth {
        if (_intent.sharesOut == 0) revert Error.Share__ZeroShares();
        if (address(_holder) == _intent.fundParams.master) revert Error.Share__MasterCannotSell();
        if (_store.liquidationRateMap(_fund) != 0) revert Error.Share__FundLiquidated();

        ShareToken _shareToken = ShareToken(_shareGate.verifyShareToken(_fund, _intent.fundParams));
        RedeemStore.Pool memory _pool = _store.getPool(_fund);
        RedeemStore.Position memory _position = _store.getPosition(_fund, address(_holder));

        uint _poolShares = _shareToken.balanceOf(address(_store));
        if (_pool.weight > _poolShares * WEIGHT_RATIO_CAP) revert Error.Share__PoolDegraded();
        uint _claimed = _settle(_store, _fund, _position, _pool);
        uint _added =
            _pool.weight == 0 ? _intent.sharesOut : Math.mulDiv(_intent.sharesOut, _pool.weight, _poolShares);
        if (_added == 0) revert Error.Share__ZeroWeightAdded();

        _shareGate.transferFrom(_shareToken, address(_holder), address(_store), _intent.sharesOut);

        _position.weight += _added;
        _pool.weight += _added;
        _store.setPool(_fund, _pool);
        _store.setPosition(_fund, address(_holder), _position);

        if (_claimed > 0) _store.transferOut(IERC20(_baseToken), address(_holder), _claimed, _transferGasLimit);
        _accountGate.dispatch(
            _holder,
            CallLib.feeOnly(_baseToken, _feeReceiver, _actualRelayFee, _transferGasLimit),
            SignLib.transfer(_baseToken,_claimed, _actualRelayFee),
            _digest,
            _userSignature,
            _attestorSignature,
            _attestor,
            _intent.nonce
        );

        uint _holderShares = _shareToken.balanceOf(address(_holder));
        uint _storeShares = _shareToken.balanceOf(address(_store));
        _logEvent(
            "Sell",
            abi.encode(
                _intent,
                _actualRelayFee,
                _fund,
                _holder,
                _pool,
                _position,
                _holderShares,
                _storeShares,
                _claimed
            )
        );
    }

    function claim(
        ClaimIntent calldata _intent,
        RedeemStore _store,
        Account _accountGate,
        Issue _shareGate,
        address _baseToken,
        address _fund,
        bytes32 _digest,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        address _attestor,
        uint _transferGasLimit,
        address _feeReceiver,
        uint _actualRelayFee
    ) external auth returns (uint claimed_) {
        IAccount _holder = IAccount(address(_accountGate.verifyPuppetAccount(_intent.params)));

        ShareToken _shareToken = ShareToken(_shareGate.verifyShareToken(_fund, _intent.fundParams));
        RedeemStore.Pool memory _pool = _store.getPool(_fund);
        RedeemStore.Position memory _position = _store.getPosition(_fund, address(_holder));
        claimed_ = _settle(_store, _fund, _position, _pool);

        uint _preSupply = _shareToken.totalSupply();
        uint _surrendered;
        uint _liquidationRate = _store.liquidationRateMap(_fund);
        if (_liquidationRate != 0) {
            _surrendered = _shareToken.balanceOf(address(_holder));
            if (_surrendered > 0) {
                _shareGate.burn(_shareToken, address(_holder), _surrendered);
                claimed_ += Precision.applyFactor(_liquidationRate, _surrendered);
            }
        }
        if (claimed_ == 0) revert Error.Share__Empty();
        if (_actualRelayFee >= claimed_) revert Error.Share__RelayFeeTooHigh();

        uint _poolShares = _shareToken.balanceOf(address(_store));
        if (_position.weight > 0 && Math.mulDiv(_position.weight, _poolShares, _pool.weight) == 0) {
            _pool.weight -= _position.weight;
            _position.weight = 0;
        }

        _store.setPool(_fund, _pool);
        if (_position.weight == 0) delete _position;
        _store.setPosition(_fund, address(_holder), _position);

        _store.transferOut(IERC20(_baseToken), address(_holder), claimed_, _transferGasLimit);
        _accountGate.dispatch(
            _holder,
            CallLib.feeOnly(_baseToken, _feeReceiver, _actualRelayFee, _transferGasLimit),
            SignLib.transfer(_baseToken,claimed_, _actualRelayFee),
            _digest,
            _userSignature,
            _attestorSignature,
            _attestor,
            _intent.nonce
        );

        uint _holderShares = _shareToken.balanceOf(address(_holder));
        _logEvent(
            "Claim",
            abi.encode(
                _intent,
                _actualRelayFee,
                _fund,
                _holder,
                _pool,
                _position,
                _preSupply,
                _surrendered,
                _holderShares,
                claimed_
            )
        );
    }

    function redeem(
        RedeemIntent calldata _intent,
        RedeemStore _store,
        Account _accountGate,
        Issue _shareGate,
        address _baseToken,
        address _fund,
        bytes32 _digest,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        address _attestor,
        uint _transferGasLimit,
        address _feeReceiver,
        uint _actualRelayFee
    ) external auth {
        if (_intent.acceptableNetAssetValue == 0) revert Error.Redeem__ZeroAcceptableNav();
        if (_store.liquidationRateMap(_fund) != 0) revert Error.Share__FundLiquidated();
        ShareToken _shareToken = ShareToken(_shareGate.verifyShareToken(_fund, _intent.fundParams));
        uint _supply = _shareToken.totalSupply();
        if (_supply == 0) revert Error.Redeem__NothingToRetire();

        uint _poolShares = _shareToken.balanceOf(address(_store));
        RedeemStore.Pool memory _pool = _store.getPool(_fund);
        RedeemStore.Position memory _position = _store.getPosition(_fund, _intent.fundParams.master);
        uint _owed = _settle(_store, _fund, _position, _pool);
        if (_intent.sharesOut > 0) {
            if (_pool.weight > _poolShares * WEIGHT_RATIO_CAP) revert Error.Share__PoolDegraded();
            uint _added = _pool.weight == 0
                ? _intent.sharesOut
                : Math.mulDiv(_intent.sharesOut, _pool.weight, _poolShares);
            if (_added == 0) revert Error.Share__ZeroWeightAdded();

            _position.weight += _added;
            _pool.weight += _added;

            _shareGate.transferFrom(_shareToken, _intent.fundParams.master, address(_store), _intent.sharesOut);
            _poolShares += _intent.sharesOut;
        }

        uint _masterShares = _shareToken.balanceOf(_intent.fundParams.master);
        if (_position.weight > 0 && 2 * _masterShares < _supply - _poolShares) {
            revert Error.Redeem__MasterSkinTooLow();
        }

        uint _queueValue = Math.mulDiv(_poolShares, _intent.acceptableNetAssetValue, _supply);
        if (_intent.assetsOut > _queueValue) revert Error.Redeem__DrainExceedsQueue();
        uint _sharesRetired = _intent.assetsOut == _queueValue
            ? _poolShares
            : Math.mulDiv(_intent.assetsOut, _supply, _intent.acceptableNetAssetValue);
        if (_sharesRetired == 0) revert Error.Redeem__NothingToRetire();
        if (_intent.assetsOut <= _actualRelayFee) revert Error.Redeem__RelayFeeTooHigh();
        uint _netDrainedBase = _intent.assetsOut - _actualRelayFee;

        IAccount.Call memory _drain = CallLib.transfer(_baseToken, address(_store), _netDrainedBase, _transferGasLimit);
        IAccount.Call[] memory _callList = _actualRelayFee > 0
            ? CallLib.compose(_drain, CallLib.fee(_baseToken, _feeReceiver, _actualRelayFee, _transferGasLimit))
            : CallLib.compose(_drain);

        _accountGate.dispatch(
            IAccount(_fund),
            _callList,
            SignLib.transfer(_baseToken,0, _intent.assetsOut),
            _digest,
            _userSignature,
            _attestorSignature,
            _attestor,
            _intent.nonce
        );

        _store.recognize(IERC20(_baseToken), _netDrainedBase);
        _pool.accruedPerWeight = _applyCredit(_pool, _netDrainedBase);
        uint _accruedPerWeight = _pool.accruedPerWeight;
        _shareGate.burn(_shareToken, address(_store), _sharesRetired);
        bool _wipeout = _sharesRetired == _poolShares;

        uint _claimed;
        if (_position.weight > 0 || _owed > 0) {
            _claimed = _owed + _syncAccrued(_position, _accruedPerWeight);

            if (_position.weight > 0 && Math.mulDiv(_position.weight, _poolShares - _sharesRetired, _pool.weight) == 0) {
                if (!_wipeout) _pool.weight -= _position.weight;
                _position.weight = 0;
            }
            if (_position.weight == 0) {
                delete _position;
            } else {
                _position.cursor = _accruedPerWeight;
            }
            _store.setPosition(_fund, _intent.fundParams.master, _position);
            if (_claimed > 0) {
                _store.transferOut(IERC20(_baseToken), _intent.fundParams.master, _claimed, _transferGasLimit);
                _accountGate.dispatch(
                    IAccount(_intent.fundParams.master),
                    CallLib.empty(),
                    SignLib.transfer(_baseToken,_claimed, 0),
                    _digest,
                    _userSignature,
                    _attestorSignature,
                    _attestor,
                    _intent.nonce
                );
            }
        }

        if (_wipeout) {
            _store.setClosedEpochAccrued(_fund, _pool.epoch, _accruedPerWeight);
            _pool = RedeemStore.Pool({epoch: _pool.epoch + 1, accruedPerWeight: 0, weight: 0});
        }
        _store.setPool(_fund, _pool);

        uint _storeShares = _shareToken.balanceOf(address(_store));
        _logEvent(
            "Redeem",
            abi.encode(
                _intent,
                _actualRelayFee,
                _fund,
                _pool,
                _position,
                _supply,
                _accruedPerWeight,
                _sharesRetired,
                _masterShares,
                _storeShares,
                _claimed
            )
        );
    }

    function liquidate(
        LiquidateIntent calldata _intent,
        RedeemStore _store,
        Account _accountGate,
        Issue _shareGate,
        address _baseToken,
        address _fund,
        bytes32 _digest,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        address _attestor,
        uint _transferGasLimit,
        address _feeReceiver,
        uint _actualRelayFee
    ) external auth {
        if (_intent.acceptableNetAssetValue == 0) revert Error.Redeem__ZeroAcceptableNav();
        if (_store.liquidationRateMap(_fund) != 0) revert Error.Share__FundLiquidated();
        ShareToken _shareToken = ShareToken(_shareGate.verifyShareToken(_fund, _intent.fundParams));
        uint _supply = _shareToken.totalSupply();
        if (_supply == 0) revert Error.Redeem__NothingToRetire();
        if (_intent.acceptableNetAssetValue <= _actualRelayFee) revert Error.Redeem__RelayFeeTooHigh();
        uint _netDrainedBase = _intent.acceptableNetAssetValue - _actualRelayFee;
        uint _liquidationRate = Precision.toFactor(_netDrainedBase, _supply);
        if (_liquidationRate == 0) revert Error.Redeem__LiquidationRateTooSmall();

        uint _poolShares = _shareToken.balanceOf(address(_store));
        RedeemStore.Pool memory _pool = _store.getPool(_fund);
        RedeemStore.Position memory _position = _store.getPosition(_fund, _intent.fundParams.master);
        uint _owed = _settle(_store, _fund, _position, _pool);

        IAccount.Call memory _drain = CallLib.transfer(_baseToken, address(_store), _netDrainedBase, _transferGasLimit);
        IAccount.Call[] memory _callList = _actualRelayFee > 0
            ? CallLib.compose(_drain, CallLib.fee(_baseToken, _feeReceiver, _actualRelayFee, _transferGasLimit))
            : CallLib.compose(_drain);

        _accountGate.dispatch(
            IAccount(_fund),
            _callList,
            SignLib.transfer(_baseToken,0, _intent.acceptableNetAssetValue),
            _digest,
            _userSignature,
            _attestorSignature,
            _attestor,
            _intent.nonce
        );

        _store.recognize(IERC20(_baseToken), _netDrainedBase);
        uint _accruedPerWeight = _pool.accruedPerWeight;
        uint _queueSlice;
        if (_poolShares > 0) {
            _queueSlice = Math.mulDiv(_poolShares, _netDrainedBase, _supply);
            if (_queueSlice > 0) _accruedPerWeight = _applyCredit(_pool, _queueSlice);
            _shareGate.burn(_shareToken, address(_store), _poolShares);
        }
        _store.setLiquidationRate(_fund, _liquidationRate);

        uint _claimed = _owed + _syncAccrued(_position, _accruedPerWeight);
        uint _surrendered = _shareToken.balanceOf(_intent.fundParams.master);
        if (_surrendered > 0) {
            _shareGate.burn(_shareToken, _intent.fundParams.master, _surrendered);
            _claimed += Precision.applyFactor(_liquidationRate, _surrendered);
        }
        delete _position;
        _store.setPosition(_fund, _intent.fundParams.master, _position);
        if (_claimed > 0) {
            _store.transferOut(IERC20(_baseToken), _intent.fundParams.master, _claimed, _transferGasLimit);
            _accountGate.dispatch(
                IAccount(_intent.fundParams.master),
                CallLib.empty(),
                SignLib.transfer(_baseToken,_claimed, 0),
                _digest,
                _userSignature,
                _attestorSignature,
                _attestor,
                _intent.nonce
            );
        }

        if (_poolShares > 0) {
            _store.setClosedEpochAccrued(_fund, _pool.epoch, _accruedPerWeight);
            _pool = RedeemStore.Pool({epoch: _pool.epoch + 1, accruedPerWeight: 0, weight: 0});
            _store.setPool(_fund, _pool);
        }

        uint _masterShares = _shareToken.balanceOf(_intent.fundParams.master);
        uint _storeShares = _shareToken.balanceOf(address(_store));
        _logEvent(
            "Liquidate",
            abi.encode(
                _intent,
                _actualRelayFee,
                _fund,
                _pool,
                _position,
                _supply,
                _accruedPerWeight,
                _liquidationRate,
                _poolShares,
                _surrendered,
                _masterShares,
                _storeShares,
                _claimed
            )
        );
    }

    function _syncAccrued(
        RedeemStore.Position memory _position,
        uint _accruedPerWeight
    ) internal pure returns (uint) {
        if (_position.weight == 0 || _position.cursor == _accruedPerWeight) return 0;
        return Precision.applyFactor(_accruedPerWeight - _position.cursor, _position.weight);
    }

    function _settle(
        RedeemStore _store,
        address _fund,
        RedeemStore.Position memory _position,
        RedeemStore.Pool memory _pool
    ) internal view returns (uint accrued_) {
        if (_position.epoch < _pool.epoch) {
            accrued_ = _syncAccrued(_position, _store.closedEpochAccruedMap(_fund, _position.epoch));
            _position.epoch = _pool.epoch;
            _position.weight = 0;
        } else {
            accrued_ = _syncAccrued(_position, _pool.accruedPerWeight);
        }
        _position.cursor = _pool.accruedPerWeight;
    }

    function _applyCredit(
        RedeemStore.Pool memory _pool,
        uint _amount
    ) internal pure returns (uint) {
        if (_pool.weight == 0) revert Error.Share__NoWeightToCredit();
        uint _credit = Precision.toFactor(_amount, _pool.weight);
        if (_credit == 0) revert Error.Share__CreditTooSmall();
        return _pool.accruedPerWeight + _credit;
    }
}
