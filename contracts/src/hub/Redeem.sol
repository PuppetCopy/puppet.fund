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
import {Error} from "../utils/Error.sol";
import {IAuthority} from "../utils/interfaces/IAuthority.sol";
import {Precision} from "../utils/Precision.sol";
import {RedeemStore} from "./store/RedeemStore.sol";
import {ShareLib} from "../utils/ShareLib.sol";
import {ShareToken} from "./ShareToken.sol";

bytes32 constant SELL_INTENT_TYPEHASH = keccak256(
    "SellIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,ShareInitParams share,uint256 sharesOut)AccountInitParams(address user,address signer)ShareInitParams(address master,bytes32 baseTokenId,bytes32 name)"
);

bytes32 constant CLAIM_INTENT_TYPEHASH = keccak256(
    "ClaimIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,ShareInitParams share,uint256 amount)AccountInitParams(address user,address signer)ShareInitParams(address master,bytes32 baseTokenId,bytes32 name)"
);

bytes32 constant REDEEM_INTENT_TYPEHASH = keccak256(
    "RedeemIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,ShareInitParams share,uint256 sharesOut,uint256 assetsOut,uint256 acceptableNetAssetValue)AccountInitParams(address user,address signer)ShareInitParams(address master,bytes32 baseTokenId,bytes32 name)"
);

bytes32 constant LIQUIDATE_INTENT_TYPEHASH = keccak256(
    "LiquidateIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,ShareInitParams share,uint256 acceptableNetAssetValue)AccountInitParams(address user,address signer)ShareInitParams(address master,bytes32 baseTokenId,bytes32 name)"
);

uint constant STAKE_RATIO_CAP = 1e6;

contract Redeem is Access {
    struct SellIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        ShareLib.ShareInitParams share;
        uint sharesOut;
    }

    struct ClaimIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        ShareLib.ShareInitParams share;
        uint amount;
    }

    struct RedeemIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        ShareLib.ShareInitParams share;
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
        ShareLib.ShareInitParams share;
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

    function _syncAccrued(
        RedeemStore.Position memory _position,
        uint _accruedPerStake
    ) internal pure returns (uint) {
        if (_position.stake == 0 || _position.cursor == _accruedPerStake) return _position.accrued;
        return _position.accrued + Precision.applyFactor(_accruedPerStake - _position.cursor, _position.stake);
    }

    function _settle(
        RedeemStore _store,
        address _fund,
        RedeemStore.Position memory _position,
        RedeemStore.Pool memory _pool
    ) internal view returns (uint available_) {
        if (_position.epoch < _pool.epoch) {
            available_ = _syncAccrued(_position, _store.closedEpochAccruedMap(_fund, _position.epoch));
            _position.epoch = _pool.epoch;
            _position.stake = 0;
        } else {
            available_ = _syncAccrued(_position, _pool.accruedPerStake);
        }
        _position.accrued = available_;
        _position.cursor = _pool.accruedPerStake;
    }

    function getUnsoldShares(
        RedeemStore _store,
        ShareToken _shareToken,
        address _holder
    ) external view returns (uint) {
        address _fund = _shareToken.getFund();
        RedeemStore.Pool memory _pool = _store.getPool(_fund);
        RedeemStore.Position memory _position = _store.getPosition(_fund, _holder);
        if (_position.stake == 0 || _position.epoch < _pool.epoch) return 0;
        return Math.mulDiv(_position.stake, _shareToken.balanceOf(address(_store)), _pool.totalStake);
    }

    function sell(
        SellIntent calldata _intent,
        IAccount _holder,
        RedeemStore _store,
        Account _accountGate,
        Issue _shareGate,
        IERC20 _baseToken,
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
        if (address(_holder) == _intent.share.master) revert Error.Share__MasterCannotSell();
        if (_store.closeRateMap(_fund) != 0) revert Error.Share__FundClosed();

        ShareToken _shareToken = ShareToken(_shareGate.verifyShareToken(_fund, _intent.share));
        RedeemStore.Pool memory _pool = _store.getPool(_fund);
        RedeemStore.Position memory _position = _store.getPosition(_fund, address(_holder));

        uint _totalShares = _shareToken.balanceOf(address(_store));
        if (_pool.totalStake > _totalShares * STAKE_RATIO_CAP) revert Error.Share__PoolDegraded();
        uint _claimed = _settle(_store, _fund, _position, _pool);
        uint _added =
            _pool.totalStake == 0 ? _intent.sharesOut : Math.mulDiv(_intent.sharesOut, _pool.totalStake, _totalShares);
        if (_added == 0) revert Error.Share__ZeroStakeAdded();

        if (_claimed > 0) _store.transferOut(_baseToken, address(_holder), _claimed, _transferGasLimit);

        _accountGate.dispatch(
            _holder,
            CallLib.feeOnly(_baseToken, _feeReceiver, _actualRelayFee, _transferGasLimit),
            CallLib.signTransfer(_intent.share.baseTokenId, _baseToken, _claimed, _actualRelayFee),
            _digest,
            _userSignature,
            _attestorSignature,
            _attestor,
            _intent.nonce
        );
        _shareGate.transferFrom(_shareToken, address(_holder), address(_store), _intent.sharesOut);

        _position.accrued = 0;
        _position.stake += _added;
        _pool.totalStake += _added;

        _store.setPool(_fund, _pool);
        _store.setPosition(_fund, address(_holder), _position);

        _logEvent(
            "Sell",
            abi.encode(
                _intent,
                _holder,
                _fund,
                _pool.epoch,
                _position.stake,
                _claimed,
                _position.cursor,
                _pool.totalStake,
                _totalShares
            )
        );
    }

    function claim(
        ClaimIntent calldata _intent,
        RedeemStore _store,
        Account _accountGate,
        Issue _shareGate,
        IERC20 _baseToken,
        address _fund,
        bytes32 _digest,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        address _attestor,
        uint _transferGasLimit,
        address _feeReceiver,
        uint _actualRelayFee
    ) external auth returns (uint paidAmount_) {
        IAccount _holder = IAccount(address(_accountGate.verifyPuppetAccount(_intent.params)));
        if (_intent.amount == 0) revert Error.Share__Empty();
        paidAmount_ = _intent.amount;
        if (_actualRelayFee >= paidAmount_) revert Error.Share__RelayFeeTooHigh();

        ShareToken _shareToken = ShareToken(_shareGate.verifyShareToken(_fund, _intent.share));
        RedeemStore.Pool memory _pool = _store.getPool(_fund);
        RedeemStore.Position memory _position = _store.getPosition(_fund, address(_holder));
        uint _available = _settle(_store, _fund, _position, _pool);

        uint _surrendered;
        uint _closeRate = _store.closeRateMap(_fund);
        if (_closeRate != 0) {
            _surrendered = _shareToken.balanceOf(address(_holder));
            if (_surrendered > 0) {
                _shareGate.burn(_shareToken, address(_holder), _surrendered);
                _available += Precision.applyFactor(_closeRate, _surrendered);
            }
        }
        if (paidAmount_ > _available) revert Error.Share__InsufficientClaimable();

        uint _accruedAfter = _available - paidAmount_;
        uint _totalShares = _shareToken.balanceOf(address(_store));

        if (_position.stake > 0 && Math.mulDiv(_position.stake, _totalShares, _pool.totalStake) == 0) {
            _pool.totalStake -= _position.stake;
            _position.stake = 0;
        }

        _store.transferOut(_baseToken, address(_holder), paidAmount_, _transferGasLimit);
        _accountGate.dispatch(
            _holder,
            CallLib.feeOnly(_baseToken, _feeReceiver, _actualRelayFee, _transferGasLimit),
            CallLib.signTransfer(_intent.share.baseTokenId, _baseToken, paidAmount_, _actualRelayFee),
            _digest,
            _userSignature,
            _attestorSignature,
            _attestor,
            _intent.nonce
        );

        _store.setPool(_fund, _pool);
        if (_position.stake == 0 && _accruedAfter == 0) {
            _store.deletePosition(_fund, address(_holder));
        } else {
            _position.accrued = _accruedAfter;
            _store.setPosition(_fund, address(_holder), _position);
        }

        _logEvent(
            "Claim",
            abi.encode(
                _intent,
                _holder,
                _fund,
                _pool.epoch,
                _position.stake,
                _accruedAfter,
                _pool.accruedPerStake,
                _pool.totalStake,
                _totalShares,
                _surrendered
            )
        );
    }

    function redeem(
        RedeemIntent calldata _intent,
        RedeemStore _store,
        Account _accountGate,
        Issue _shareGate,
        IERC20 _baseToken,
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
        if (_store.closeRateMap(_fund) != 0) revert Error.Share__FundClosed();
        ShareToken _shareToken = ShareToken(_shareGate.verifyShareToken(_fund, _intent.share));
        uint _supply = _shareToken.totalSupply();
        if (_supply == 0) revert Error.Redeem__NothingToRetire();

        uint _poolShares = _shareToken.balanceOf(address(_store));
        RedeemStore.Pool memory _pool = _store.getPool(_fund);
        RedeemStore.Position memory _position = _store.getPosition(_fund, _intent.share.master);
        _settle(_store, _fund, _position, _pool);
        if (_intent.sharesOut > 0) {
            if (_pool.totalStake > _poolShares * STAKE_RATIO_CAP) revert Error.Share__PoolDegraded();
            uint _added = _pool.totalStake == 0
                ? _intent.sharesOut
                : Math.mulDiv(_intent.sharesOut, _pool.totalStake, _poolShares);
            if (_added == 0) revert Error.Share__ZeroStakeAdded();

            _position.stake += _added;
            _pool.totalStake += _added;
            _store.setPool(_fund, _pool);

            _shareGate.transferFrom(_shareToken, _intent.share.master, address(_store), _intent.sharesOut);
            _poolShares += _intent.sharesOut;
        }

        if (_position.stake > 0) {
            uint _masterShares = _shareToken.balanceOf(_intent.share.master);
            if (_masterShares * _pool.totalStake + _position.stake * _poolShares < _position.stake * _supply) {
                revert Error.Redeem__MasterFractionDecreased();
            }
        }

        uint _queueValue = Math.mulDiv(_poolShares, _intent.acceptableNetAssetValue, _supply);
        if (_intent.assetsOut > _queueValue) revert Error.Redeem__DrainExceedsQueue();
        uint _sharesRetired = _intent.assetsOut == _queueValue
            ? _poolShares
            : Math.mulDiv(_intent.assetsOut, _supply, _intent.acceptableNetAssetValue);
        if (_sharesRetired == 0) revert Error.Redeem__NothingToRetire();
        if (_intent.assetsOut <= _actualRelayFee) revert Error.Redeem__RelayFeeTooHigh();
        uint _netDrainedBase = _intent.assetsOut - _actualRelayFee;

        _accountGate.dispatch(
            IAccount(_fund),
            CallLib.withFee(
                CallLib.transferCall(_baseToken, address(_store), _netDrainedBase, _transferGasLimit),
                _baseToken,
                _feeReceiver,
                _actualRelayFee,
                _transferGasLimit
            ),
            CallLib.signTransfer(_intent.share.baseTokenId, _baseToken, 0, _intent.assetsOut),
            _digest,
            _userSignature,
            _attestorSignature,
            _attestor,
            _intent.nonce
        );

        _store.recognize(_baseToken, _netDrainedBase);
        (uint _accruedPerStake, uint _totalStake) = _store.creditPool(_fund, _netDrainedBase);
        _shareGate.burn(_shareToken, address(_store), _sharesRetired);
        bool _wipeout = _sharesRetired == _poolShares;

        uint _claimed;
        if (_position.stake > 0 || _position.accrued > 0) {
            _claimed = _syncAccrued(_position, _accruedPerStake);

            if (_position.stake > 0 && Math.mulDiv(_position.stake, _poolShares - _sharesRetired, _totalStake) == 0) {
                if (!_wipeout) {
                    _totalStake -= _position.stake;
                    _store.setPool(
                        _fund,
                        RedeemStore.Pool({
                            epoch: _pool.epoch,
                            accruedPerStake: _accruedPerStake,
                            totalStake: _totalStake
                        })
                    );
                }
                _position.stake = 0;
            }
            if (_position.stake == 0) {
                _store.deletePosition(_fund, _intent.share.master);
            } else {
                _position.accrued = 0;
                _position.cursor = _accruedPerStake;
                _store.setPosition(_fund, _intent.share.master, _position);
            }
            if (_claimed > 0) {
                _store.transferOut(_baseToken, _intent.share.master, _claimed, _transferGasLimit);
                _accountGate.dispatch(
                    IAccount(_intent.share.master),
                    new IAccount.Call[](0),
                    CallLib.signTransfer(_intent.share.baseTokenId, _baseToken, _claimed, 0),
                    _digest,
                    _userSignature,
                    _attestorSignature,
                    _attestor,
                    _intent.nonce
                );
            }
        }

        if (_wipeout) {
            _store.rotatePool(_fund);
            _totalStake = 0;
        }

        _logEvent(
            "Redeem",
            abi.encode(
                _intent,
                _fund,
                _pool.epoch,
                _supply,
                _sharesRetired,
                _accruedPerStake,
                _totalStake,
                _poolShares,
                _position.stake,
                _claimed,
                _actualRelayFee
            )
        );
    }

    function liquidate(
        LiquidateIntent calldata _intent,
        RedeemStore _store,
        Account _accountGate,
        Issue _shareGate,
        IERC20 _baseToken,
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
        if (_store.closeRateMap(_fund) != 0) revert Error.Share__FundClosed();
        ShareToken _shareToken = ShareToken(_shareGate.verifyShareToken(_fund, _intent.share));
        uint _supply = _shareToken.totalSupply();
        if (_supply == 0) revert Error.Redeem__NothingToRetire();
        if (_intent.acceptableNetAssetValue <= _actualRelayFee) revert Error.Redeem__RelayFeeTooHigh();
        uint _netDrainedBase = _intent.acceptableNetAssetValue - _actualRelayFee;
        uint _closeRate = Precision.toFactor(_netDrainedBase, _supply);
        if (_closeRate == 0) revert Error.Share__CreditTooSmall();

        uint _poolShares = _shareToken.balanceOf(address(_store));
        RedeemStore.Pool memory _pool = _store.getPool(_fund);
        RedeemStore.Position memory _position = _store.getPosition(_fund, _intent.share.master);
        _settle(_store, _fund, _position, _pool);

        _accountGate.dispatch(
            IAccount(_fund),
            CallLib.withFee(
                CallLib.transferCall(_baseToken, address(_store), _netDrainedBase, _transferGasLimit),
                _baseToken,
                _feeReceiver,
                _actualRelayFee,
                _transferGasLimit
            ),
            CallLib.signTransfer(_intent.share.baseTokenId, _baseToken, 0, _intent.acceptableNetAssetValue),
            _digest,
            _userSignature,
            _attestorSignature,
            _attestor,
            _intent.nonce
        );

        _store.recognize(_baseToken, _netDrainedBase);
        uint _accruedPerStake = _pool.accruedPerStake;
        uint _queueSlice;
        if (_poolShares > 0) {
            _queueSlice = Math.mulDiv(_poolShares, _netDrainedBase, _supply);
            if (_queueSlice > 0) {
                (_accruedPerStake,) = _store.creditPool(_fund, _queueSlice);
            }
            _shareGate.burn(_shareToken, address(_store), _poolShares);
        }
        _store.closeFund(_fund, _closeRate);

        uint _claimed = _syncAccrued(_position, _accruedPerStake);
        uint _surrendered = _shareToken.balanceOf(_intent.share.master);
        if (_surrendered > 0) {
            _shareGate.burn(_shareToken, _intent.share.master, _surrendered);
            _claimed += Precision.applyFactor(_closeRate, _surrendered);
        }
        _store.deletePosition(_fund, _intent.share.master);
        if (_claimed > 0) {
            _store.transferOut(_baseToken, _intent.share.master, _claimed, _transferGasLimit);
            _accountGate.dispatch(
                IAccount(_intent.share.master),
                new IAccount.Call[](0),
                CallLib.signTransfer(_intent.share.baseTokenId, _baseToken, _claimed, 0),
                _digest,
                _userSignature,
                _attestorSignature,
                _attestor,
                _intent.nonce
            );
        }

        if (_poolShares > 0) _store.rotatePool(_fund);

        _logEvent(
            "Liquidate",
            abi.encode(
                _intent,
                _fund,
                _pool.epoch,
                _supply,
                _closeRate,
                _accruedPerStake,
                _poolShares,
                _surrendered,
                _claimed,
                _actualRelayFee
            )
        );
    }
}
