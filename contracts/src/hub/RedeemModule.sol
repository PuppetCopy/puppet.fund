// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IAccount} from "../core/interface/IAccount.sol";
import {AccountLib} from "../core/AccountLib.sol";
import {AccountModule} from "../core/module/AccountModule.sol";
import {ShareModule} from "./ShareModule.sol";
import {Access} from "../utils/auth/Access.sol";
import {CallLib} from "../utils/CallLib.sol";
import {Error} from "../utils/Error.sol";
import {IAuthority} from "../utils/interfaces/IAuthority.sol";
import {Precision} from "../utils/Precision.sol";
import {RedeemStore} from "./store/RedeemStore.sol";
import {ShareLib} from "./ShareLib.sol";
import {ShareToken} from "./ShareToken.sol";

bytes32 constant SELL_INTENT_TYPEHASH = keccak256(
    "SellIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,ShareInitParams share,uint256 sharesOut)AccountInitParams(address user,address signer)ShareInitParams(address master,bytes32 baseTokenId,bytes32 name)"
);

bytes32 constant CLAIM_INTENT_TYPEHASH = keccak256(
    "ClaimIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,ShareInitParams share,uint256 amount)AccountInitParams(address user,address signer)ShareInitParams(address master,bytes32 baseTokenId,bytes32 name)"
);

bytes32 constant FULFILL_INTENT_TYPEHASH = keccak256(
    "FulfillIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,ShareInitParams share,uint256 sharesOut,uint256 acceptableNetAssetValue,uint256 totalShareSupply,uint256 acceptableShares)AccountInitParams(address user,address signer)ShareInitParams(address master,bytes32 baseTokenId,bytes32 name)"
);

contract RedeemModule is Access {
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

    struct FulfillIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        ShareLib.ShareInitParams share;
        uint sharesOut;
        uint acceptableNetAssetValue;
        uint totalShareSupply;
        uint acceptableShares;
    }

    constructor(
        IAuthority _authority
    ) Access(_authority) {}

    function getClaimable(
        RedeemStore _store,
        address _fund,
        address _holder
    ) external view returns (uint) {
        return _syncAccrued(_store.getPosition(_fund, _holder), _store.getPool(_fund).accruedPerStake);
    }

    function _syncAccrued(
        RedeemStore.Position memory _position,
        uint _accruedPerStake
    ) internal pure returns (uint) {
        if (_position.stake == 0 || _position.cursor == _accruedPerStake) return _position.accrued;
        return _position.accrued + Precision.applyFactor(_accruedPerStake - _position.cursor, _position.stake);
    }

    function getUnsoldShares(
        RedeemStore _store,
        ShareToken _shareToken,
        address _holder
    ) external view returns (uint) {
        address _fund = _shareToken.getFund();
        uint _stake = _store.getPosition(_fund, _holder).stake;
        if (_stake == 0) return 0;
        RedeemStore.Pool memory _pool = _store.getPool(_fund);
        return Math.mulDiv(_stake, _shareToken.balanceOf(address(_store)), _pool.totalStake);
    }

    function sell(
        SellIntent calldata _intent,
        IAccount _holder,
        RedeemStore _store,
        AccountModule _accountGate,
        ShareModule _shareGate,
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

        ShareToken _shareToken = ShareToken(_shareGate.verifyShareToken(_intent.share));
        RedeemStore.Pool memory _pool = _store.getPool(_fund);
        RedeemStore.Position memory _position = _store.getPosition(_fund, address(_holder));

        uint _totalShares = _shareToken.balanceOf(address(_store));
        uint _added =
            _pool.totalStake == 0 ? _intent.sharesOut : Math.mulDiv(_intent.sharesOut, _pool.totalStake, _totalShares);
        if (_added == 0) revert Error.Share__ZeroStakeAdded();

        uint _claimed = _syncAccrued(_position, _pool.accruedPerStake);
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
        _position.cursor = _pool.accruedPerStake;
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
                _position.stake,
                _claimed,
                _position.cursor,
                _pool.totalStake,
                _totalShares + _intent.sharesOut
            )
        );
    }

    function claim(
        ClaimIntent calldata _intent,
        RedeemStore _store,
        AccountModule _accountGate,
        ShareModule _shareGate,
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

        ShareToken _shareToken = ShareToken(_shareGate.verifyShareToken(_intent.share));
        RedeemStore.Pool memory _pool = _store.getPool(_fund);
        RedeemStore.Position memory _position = _store.getPosition(_fund, address(_holder));
        uint _stake = _position.stake;
        uint _available = _syncAccrued(_position, _pool.accruedPerStake);
        if (paidAmount_ > _available) revert Error.Share__InsufficientClaimable();

        uint _accruedAfter = _available - paidAmount_;
        uint _totalShares = _shareToken.balanceOf(address(_store));
        uint _effective = _stake == 0 ? 0 : Math.mulDiv(_stake, _totalShares, _pool.totalStake);

        if (_effective == 0 && _stake > 0) {
            _pool.totalStake -= _stake;
            _stake = 0;
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
        if (_stake == 0 && _accruedAfter == 0) {
            _store.deletePosition(_fund, address(_holder));
        } else {
            _position.stake = _stake;
            _position.accrued = _accruedAfter;
            _position.cursor = _pool.accruedPerStake;
            _store.setPosition(_fund, address(_holder), _position);
        }

        _logEvent(
            "Claim",
            abi.encode(
                _intent,
                _holder,
                _fund,
                _effective,
                _stake,
                _accruedAfter,
                _pool.accruedPerStake,
                _pool.totalStake,
                _totalShares
            )
        );
    }

    function fulfill(
        FulfillIntent calldata _intent,
        RedeemStore _store,
        AccountModule _accountGate,
        ShareModule _shareGate,
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
        if (_intent.acceptableNetAssetValue == 0) revert Error.Fulfill__ZeroAcceptableNav();
        ShareToken _shareToken = ShareToken(_shareGate.verifyShareToken(_intent.share));
        uint _supply = _shareToken.totalSupply();
        if (_supply != _intent.totalShareSupply) {
            revert Error.Fulfill__SupplyMismatch(_supply, _intent.totalShareSupply);
        }

        uint _poolShares = _shareToken.balanceOf(address(_store));
        uint _claimed;
        if (_intent.sharesOut > 0) {
            address _master = _intent.share.master;
            RedeemStore.Pool memory _pool = _store.getPool(_fund);
            RedeemStore.Position memory _position = _store.getPosition(_fund, _master);
            uint _added = _pool.totalStake == 0
                ? _intent.sharesOut
                : Math.mulDiv(_intent.sharesOut, _pool.totalStake, _poolShares);
            if (_added == 0) revert Error.Share__ZeroStakeAdded();

            _claimed = _syncAccrued(_position, _pool.accruedPerStake);
            _position.accrued = 0;
            _position.cursor = _pool.accruedPerStake;
            _position.stake += _added;
            _pool.totalStake += _added;
            _store.setPool(_fund, _pool);
            _store.setPosition(_fund, _master, _position);

            _shareGate.transferFrom(_shareToken, _master, address(_store), _intent.sharesOut);
            _poolShares += _intent.sharesOut;

            if (_claimed > 0) {
                _store.transferOut(_baseToken, _master, _claimed, _transferGasLimit);
                _accountGate.dispatch(
                    IAccount(_master),
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

        uint _maxRetirable = _poolShares == _supply ? _poolShares : _poolShares >= 2 ? _poolShares - 1 : 0;
        uint _sharesRetired = _intent.acceptableShares < _maxRetirable ? _intent.acceptableShares : _maxRetirable;
        uint _drainedBase = Math.mulDiv(_sharesRetired, _intent.acceptableNetAssetValue, _supply);
        if (_sharesRetired == 0) revert Error.Fulfill__NothingToRetire();
        if (_drainedBase <= _actualRelayFee) revert Error.Fulfill__RelayFeeTooHigh();
        uint _netDrainedBase = _drainedBase - _actualRelayFee;

        _accountGate.dispatch(
            IAccount(_fund),
            CallLib.withFee(
                CallLib.approveCall(_baseToken, address(_store), _netDrainedBase, _transferGasLimit),
                _baseToken,
                _feeReceiver,
                _actualRelayFee,
                _transferGasLimit
            ),
            CallLib.noTransfers(),
            _digest,
            _userSignature,
            _attestorSignature,
            _attestor,
            _intent.nonce
        );

        (uint _accruedPerStake, uint _totalStake) =
            _store.creditPool(_fund, _baseToken, _fund, _netDrainedBase, _transferGasLimit);
        _shareGate.burn(_shareToken, address(_store), _sharesRetired);

        _logEvent(
            "Fulfill",
            abi.encode(
                _intent,
                _fund,
                _baseToken,
                _sharesRetired,
                _drainedBase,
                _accruedPerStake,
                _totalStake,
                _poolShares,
                _supply - _sharesRetired,
                _claimed
            )
        );
    }
}
