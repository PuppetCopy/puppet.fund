// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IAccount} from "../../core/interface/IAccount.sol";
import {AccountLib} from "../../core/AccountLib.sol";
import {AccountModule} from "../../core/module/AccountModule.sol";
import {ShareModule} from "../ShareModule.sol";
import {Access} from "../../utils/auth/Access.sol";
import {Error} from "../../utils/Error.sol";
import {IAuthority} from "../../utils/interfaces/IAuthority.sol";
import {Precision} from "../../utils/Precision.sol";
import {RedeemStore} from "../RedeemStore.sol";
import {ShareToken} from "../ShareToken.sol";

bytes32 constant SELL_INTENT_TYPEHASH = keccak256(
    "SellIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,AccountInitParams masterParams,uint256 sharesOut)AccountInitParams(address user,bytes32 name,bytes32 baseTokenId,address signer)"
);

bytes32 constant CLAIM_INTENT_TYPEHASH = keccak256(
    "ClaimIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,AccountInitParams masterParams,uint256 amount)AccountInitParams(address user,bytes32 name,bytes32 baseTokenId,address signer)"
);

bytes32 constant FULFILL_INTENT_TYPEHASH = keccak256(
    "FulfillIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,uint256 acceptableNetAssetValue,uint256 totalShareSupply,uint256 acceptableShares)AccountInitParams(address user,bytes32 name,bytes32 baseTokenId,address signer)"
);

contract RedeemModule is Access {
    struct SellIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        AccountLib.AccountInitParams masterParams;
        uint sharesOut;
    }

    struct ClaimIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        AccountLib.AccountInitParams masterParams;
        uint amount;
    }

    struct FulfillIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        uint acceptableNetAssetValue;
        uint totalShareSupply;
        uint acceptableShares;
    }

    constructor(
        IAuthority _authority
    ) Access(_authority) {}

    function getClaimable(
        RedeemStore _store,
        address _masterAccount,
        IERC20 _baseToken,
        address _puppetAccount
    ) external view returns (uint) {
        RedeemStore.Position memory _position = _store.getPosition(_masterAccount, _baseToken, _puppetAccount);
        if (_position.stake == 0) return _position.accrued;
        RedeemStore.Pool memory _pool = _store.getPool(_masterAccount, _baseToken);
        return _position.accrued + Precision.applyFactor(_pool.accruedPerStake - _position.cursor, _position.stake);
    }

    function getUnsoldShares(
        RedeemStore _store,
        address _masterAccount,
        IERC20 _baseToken,
        address _puppetAccount,
        ShareToken _shareToken
    ) external view returns (uint) {
        uint _stake = _store.getPosition(_masterAccount, _baseToken, _puppetAccount).stake;
        if (_stake == 0) return 0;
        RedeemStore.Pool memory _pool = _store.getPool(_masterAccount, _baseToken);
        return Math.mulDiv(_stake, _shareToken.balanceOf(address(_store)), _pool.totalStake);
    }

    function sell(
        SellIntent calldata _intent,
        address _masterAccount,
        RedeemStore _store,
        AccountModule _accountGate,
        IERC20 _baseToken,
        ShareToken _shareToken,
        bytes32 _digest,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        address _attestor,
        uint _transferGasLimit,
        address _feeReceiver,
        uint _actualRelayFee
    ) external auth {
        if (_intent.sharesOut == 0) revert Error.Share__ZeroShares();

        IAccount _holder = AccountLib.hashAccount(_intent.params) == AccountLib.hashAccount(_intent.masterParams)
            ? IAccount(_masterAccount)
            : IAccount(address(_accountGate.verifyPuppetAccount(_intent.params)));
        RedeemStore.Pool memory _pool = _store.getPool(_masterAccount, _baseToken);
        RedeemStore.Position memory _position = _store.getPosition(_masterAccount, _baseToken, address(_holder));

        uint _priorStake = _position.stake;
        uint _accruedPerStake = _pool.accruedPerStake;
        uint _accrued = _position.accrued;
        if (_priorStake > 0 && _position.cursor != _accruedPerStake) {
            _accrued += Precision.applyFactor(_accruedPerStake - _position.cursor, _priorStake);
        }

        uint _totalShares = _shareToken.balanceOf(address(_store));
        uint _added =
            _pool.totalStake == 0 ? _intent.sharesOut : Math.mulDiv(_intent.sharesOut, _pool.totalStake, _totalShares);
        if (_added == 0) revert Error.Share__ZeroStakeAdded();

        IAccount.Call[] memory _calls = new IAccount.Call[](1);
        _calls[0] = IAccount.Call({
            target: address(_shareToken),
            value: 0,
            gasLimit: _transferGasLimit,
            callData: abi.encodeCall(IERC20.transfer, (address(_store), _intent.sharesOut))
        });
        _accountGate.dispatch(
            _holder,
            _calls,
            _digest,
            _userSignature,
            _attestorSignature,
            _attestor,
            _intent.nonce,
            _baseToken,
            0,
            0,
            _actualRelayFee,
            _feeReceiver,
            _transferGasLimit
        );

        uint _stake = _priorStake + _added;
        uint _totalStake = _pool.totalStake + _added;
        uint _newTotalShares = _totalShares + _intent.sharesOut;

        _pool.totalStake = _totalStake;
        _position.stake = _stake;
        _position.accrued = _accrued;
        _position.cursor = _accruedPerStake;

        _store.setPool(_masterAccount, _baseToken, _pool);
        _store.setPosition(_masterAccount, _baseToken, address(_holder), _position);

        _logEvent(
            "Sell",
            abi.encode(
                _intent,
                _holder,
                _masterAccount,
                _position.stake,
                _position.accrued,
                _position.cursor,
                _pool.totalStake,
                _newTotalShares
            )
        );
    }

    function claim(
        ClaimIntent calldata _intent,
        address _masterAccount,
        RedeemStore _store,
        AccountModule _accountGate,
        IERC20 _baseToken,
        ShareToken _shareToken,
        bytes32 _digest,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        address _attestor,
        uint _transferGasLimit,
        address _feeReceiver,
        uint _actualRelayFee
    ) external auth returns (uint paidAmount_) {
        if (_intent.amount == 0) revert Error.Share__Empty();
        paidAmount_ = _intent.amount;
        if (_actualRelayFee >= paidAmount_) revert Error.Share__RelayFeeTooHigh();

        bool _isOwner = AccountLib.hashAccount(_intent.params) == AccountLib.hashAccount(_intent.masterParams);
        IAccount _holder = _isOwner
            ? IAccount(_masterAccount)
            : IAccount(address(_accountGate.verifyPuppetAccount(_intent.params)));
        RedeemStore.Pool memory _pool = _store.getPool(_masterAccount, _baseToken);
        RedeemStore.Position memory _position = _store.getPosition(_masterAccount, _baseToken, address(_holder));
        uint _stake = _position.stake;
        uint _available = _position.accrued;
        if (_stake > 0 && _position.cursor != _pool.accruedPerStake) {
            _available += Precision.applyFactor(_pool.accruedPerStake - _position.cursor, _stake);
        }
        if (paidAmount_ > _available) revert Error.Share__InsufficientClaimable();

        uint _accruedAfter = _available - paidAmount_;
        uint _totalShares = _shareToken.balanceOf(address(_store));
        uint _effective = _stake == 0 ? 0 : Math.mulDiv(_stake, _totalShares, _pool.totalStake);

        if (_effective == 0 && _stake > 0) {
            _pool.totalStake -= _stake;
            _stake = 0;
        }

        if (_isOwner) {
            _store.transferOut(_baseToken, _masterAccount, _actualRelayFee, _transferGasLimit);
            _store.transferOut(_baseToken, _holder.getUser(), paidAmount_ - _actualRelayFee, _transferGasLimit);
            _accountGate.dispatch(
                _holder,
                new IAccount.Call[](0),
                _digest,
                _userSignature,
                _attestorSignature,
                _attestor,
                _intent.nonce,
                _baseToken,
                _actualRelayFee,
                0,
                _actualRelayFee,
                _feeReceiver,
                _transferGasLimit
            );
        } else {
            _store.transferOut(_baseToken, address(_holder), paidAmount_, _transferGasLimit);
            _accountGate.dispatch(
                _holder,
                new IAccount.Call[](0),
                _digest,
                _userSignature,
                _attestorSignature,
                _attestor,
                _intent.nonce,
                _baseToken,
                paidAmount_,
                0,
                _actualRelayFee,
                _feeReceiver,
                _transferGasLimit
            );
        }

        _store.setPool(_masterAccount, _baseToken, _pool);
        if (_stake == 0 && _accruedAfter == 0) {
            _store.deletePosition(_masterAccount, _baseToken, address(_holder));
        } else {
            _position.stake = _stake;
            _position.accrued = _accruedAfter;
            _position.cursor = _pool.accruedPerStake;
            _store.setPosition(_masterAccount, _baseToken, address(_holder), _position);
        }

        _logEvent(
            "Claim",
            abi.encode(
                _intent,
                _holder,
                _masterAccount,
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
        address _masterAccount,
        RedeemStore _store,
        AccountModule _accountGate,
        ShareModule _shareGate,
        IERC20 _baseToken,
        ShareToken _shareToken,
        bytes32 _digest,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        address _attestor,
        uint _transferGasLimit,
        address _feeReceiver,
        uint _actualRelayFee
    ) external auth {
        if (_intent.acceptableNetAssetValue == 0) revert Error.Fulfill__ZeroAcceptableNav();
        uint _supply = _shareToken.totalSupply();
        if (_supply != _intent.totalShareSupply) {
            revert Error.Fulfill__SupplyMismatch(_supply, _intent.totalShareSupply);
        }

        uint _poolShares = _shareToken.balanceOf(address(_store));
        uint _maxRetirable = _poolShares >= 2 ? _poolShares - 1 : 0;
        uint _sharesRetired =
            _intent.acceptableShares < _maxRetirable ? _intent.acceptableShares : _maxRetirable;
        uint _drainedBase = Math.mulDiv(_sharesRetired, _intent.acceptableNetAssetValue, _supply);
        if (_sharesRetired == 0) revert Error.Fulfill__NothingToRetire();
        if (_drainedBase <= _actualRelayFee) revert Error.Fulfill__RelayFeeTooHigh();
        uint _netDrainedBase = _drainedBase - _actualRelayFee;

        IAccount.Call[] memory _calls = new IAccount.Call[](1);
        _calls[0] = IAccount.Call({
            target: address(_baseToken),
            value: 0,
            gasLimit: _transferGasLimit,
            callData: abi.encodeCall(IERC20.approve, (address(_store), _netDrainedBase))
        });
        _accountGate.dispatch(
            IAccount(_masterAccount),
            _calls,
            _digest,
            _userSignature,
            _attestorSignature,
            _attestor,
            _intent.nonce,
            _baseToken,
            0,
            _netDrainedBase,
            _actualRelayFee,
            _feeReceiver,
            _transferGasLimit
        );

        (uint _accruedPerStake, uint _totalStake) =
            _store.creditPool(_masterAccount, _baseToken, _masterAccount, _netDrainedBase, _transferGasLimit);
        _shareGate.burn(_shareToken, address(_store), _sharesRetired);

        uint _totalShareSupply = _supply - _sharesRetired;
        _logEvent(
            "Fulfill",
            abi.encode(
                _intent,
                _masterAccount,
                _baseToken,
                _sharesRetired,
                _drainedBase,
                _accruedPerStake,
                _totalStake,
                _poolShares,
                _totalShareSupply
            )
        );
    }
}
