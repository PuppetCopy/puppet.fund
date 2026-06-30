// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IAccount} from "../utils/interfaces/IAccount.sol";
import {AccountLib} from "../utils/AccountLib.sol";
import {Account} from "../core/Account.sol";
import {Issue} from "./Issue.sol";
import {RuleLib} from "../utils/RuleLib.sol";
import {AllocateStore} from "./store/AllocateStore.sol";
import {RedeemStore} from "./store/RedeemStore.sol";
import {Access} from "../utils/auth/Access.sol";
import {CallLib} from "../utils/CallLib.sol";
import {SignLib} from "../utils/SignLib.sol";
import {Error} from "../utils/Error.sol";
import {IAuthority} from "../utils/interfaces/IAuthority.sol";
import {ShareToken} from "./ShareToken.sol";
import {FundAccountLib} from "../utils/FundAccountLib.sol";

bytes32 constant ALLOCATE_INTENT_TYPEHASH = keccak256(
    "AllocateIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,FundAccountInitParams fundParams,uint256 acceptableNetAssetValue,uint256 totalShareSupply,uint256 masterAmount,bytes32 puppetListHash,bytes32 allocatedAmountListHash)AccountInitParams(address user,address signer)FundAccountInitParams(address master,address baseToken,bytes32 name)"
);

uint constant SHARE_PRECISION = 1e12;
uint constant MIN_MANDATE_BODY = 64;
uint constant MANDATE_GAS_BUFFER = 800_000;

contract Allocate is Access {
    struct AllocateIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        FundAccountLib.FundAccountInitParams fundParams;
        uint acceptableNetAssetValue;
        uint totalShareSupply;
        uint masterAmount;
        address[] puppetList;
        uint[] allocatedAmountList;
    }

    constructor(
        IAuthority _authority
    ) Access(_authority) {}

    function allocate(
        AllocateIntent calldata _intent,
        bytes[] calldata _bodyList,
        bytes[] calldata _mandateList,
        Account _accountGate,
        Issue _shareGate,
        AllocateStore _store,
        RedeemStore _redeemStore,
        address _baseToken,
        bytes32 _digest,
        bytes32 _routerDomainSeparator,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        address _attestor,
        uint _transferGasLimit,
        address _feeReceiver,
        uint _actualRelayFee
    ) external auth returns (uint fundAccountIn_) {
        if (_intent.acceptableNetAssetValue == 0) revert Error.Allocate__ZeroAcceptableNav();
        uint _n = _intent.puppetList.length;
        if (_bodyList.length != _n || _mandateList.length != _n || _intent.allocatedAmountList.length != _n) {
            revert Error.Allocate__ListLengthMismatch(_n, _bodyList.length, _mandateList.length);
        }

        address _fundAccount = _accountGate.predictFundAccount(_intent.fundParams);
        if (_fundAccount.code.length == 0) {
            _accountGate.createFundAccount(_intent.params.user, _intent.fundParams);
        }
        if (_redeemStore.liquidationRateMap(_fundAccount) != 0) revert Error.Share__FundLiquidated();
        ShareToken _shareToken = ShareToken(_shareGate.predict(_fundAccount, _intent.fundParams));
        uint _preMintSupply;
        if (address(_shareToken).code.length == 0) {
            _shareGate.createShareToken(_fundAccount, _intent.fundParams);
        } else {
            _preMintSupply = _shareToken.totalSupply();
            if (_preMintSupply == 0 && _redeemStore.getPool(_fundAccount).weight != 0) {
                revert Error.Share__Empty();
            }
        }
        if (_preMintSupply != _intent.totalShareSupply) {
            revert Error.Allocate__PreMintSupplyMismatch(_preMintSupply, _intent.totalShareSupply);
        }

        uint[] memory _puppetSharesMintedList = new uint[](_n);
        uint _totalAllocated;
        uint _totalPuppetMinted;
        uint _remainingFee = _preMintSupply > 0 ? _actualRelayFee : 0;
        uint _masterLeg = _intent.masterAmount > 0 ? 1 : 0;

        AllocateStore.PuppetState[] memory _stateList = _store.getPuppetStateList(_intent.puppetList, _fundAccount);
        for (uint _i; _i < _n; ++_i) {
            address _puppet = _intent.puppetList[_i];
            if (_i > 0 && uint160(_puppet) <= uint160(_intent.puppetList[_i - 1])) {
                revert Error.Allocate__PuppetListNotSorted(_intent.puppetList[_i - 1], _puppet);
            }
            if (_puppet == _intent.fundParams.master) continue;
            uint _amount = _intent.allocatedAmountList[_i];
            if (_amount == 0) continue;

            bytes calldata _body = _bodyList[_i];
            if (_body.length < MIN_MANDATE_BODY) continue;
            (bytes32 _bodyHash, bytes32 _mandateDigest) =
                RuleLib.mandate(_routerDomainSeparator, _puppet, _fundAccount, _baseToken, _body);
            if (_stateList[_i].mandate != _bodyHash) continue;
            uint _lastAllocatedAt = _stateList[_i].lastAllocatedAt;
            uint _throttle = RuleLib.throttlePeriod(_body);
            if (_throttle > type(uint).max - _lastAllocatedAt || block.timestamp < _lastAllocatedAt + _throttle) {
                continue;
            }
            uint _rateLimit = RuleLib.rateLimit(_body);
            if (_rateLimit != 0 && _amount > _rateLimit) _amount = _rateLimit;

            uint _feeSlice = _remainingFee / (_n - _i + _masterLeg);
            if (_amount <= _feeSlice) continue;
            uint _sa = _sharesFor(_amount - _feeSlice, _preMintSupply, _intent.acceptableNetAssetValue);
            if (_sa == 0) continue;

            try _accountGate.dispatchMandate{gas: _transferGasLimit + MANDATE_GAS_BUFFER}(
                IAccount(_puppet),
                _mandateDigest,
                _mandateList[_i],
                CallLib.compose(CallLib.transfer(_baseToken, _fundAccount, _amount, _transferGasLimit)),
                SignLib.transfer(_baseToken,0, _amount)
            ) returns (
                uint[] memory, uint[] memory, bytes[] memory
            ) {
                _puppetSharesMintedList[_i] = _sa;
                _totalPuppetMinted += _sa;
                _totalAllocated += _amount;
                _remainingFee -= _feeSlice;
            } catch {
                continue;
            }
        }

        uint _ownerNewShares;
        uint _masterIn = _intent.masterAmount;
        if (_masterIn > _remainingFee) {
            _ownerNewShares = _sharesFor(_masterIn - _remainingFee, _preMintSupply, _intent.acceptableNetAssetValue);
            if (_ownerNewShares == 0) {
                _masterIn = 0;
            } else {
                try _accountGate.dispatch(
                    IAccount(_intent.fundParams.master),
                    CallLib.compose(
                        CallLib.routeExecute(
                            _accountGate.predictRoute(_intent.fundParams.master),
                            CallLib.compose(CallLib.transfer(_baseToken, _fundAccount, _masterIn, _transferGasLimit))
                        )
                    ),
                    SignLib.none(),
                    _digest,
                    _userSignature,
                    _attestorSignature,
                    _attestor,
                    _intent.nonce
                ) returns (uint[] memory, uint[] memory, bytes[] memory) {
                    _remainingFee = 0;
                } catch {
                    _masterIn = 0;
                    _ownerNewShares = 0;
                }
            }
        } else {
            _masterIn = 0;
        }

        fundAccountIn_ = _masterIn + _totalAllocated;
        if (fundAccountIn_ == 0) revert Error.Allocate__ZeroAmount();

        _accountGate.dispatch(
            IAccount(_fundAccount),
            CallLib.feeOnly(_baseToken, _feeReceiver, _actualRelayFee, _transferGasLimit),
            SignLib.transfer(_baseToken,fundAccountIn_, _actualRelayFee),
            _digest,
            _userSignature,
            _attestorSignature,
            _attestor,
            _intent.nonce
        );

        uint _ownerSharesPost = _ownerNewShares > 0
            ? _shareGate.mint(_shareToken, _intent.fundParams.master, _ownerNewShares)
            : _shareToken.balanceOf(_intent.fundParams.master);
        uint[] memory _puppetSharesPostList =
            _shareGate.mintMany(_shareToken, _intent.puppetList, _puppetSharesMintedList);
        if (_totalPuppetMinted > 0) {
            _store.setLastAllocatedAtMany(_intent.puppetList, _puppetSharesMintedList, _fundAccount, block.timestamp);
        }

        _logEvent(
            "Allocate",
            abi.encode(
                _intent,
                _actualRelayFee,
                _fundAccount,
                _ownerNewShares,
                _puppetSharesPostList,
                _totalAllocated,
                _preMintSupply,
                _totalPuppetMinted,
                fundAccountIn_,
                _ownerSharesPost
            )
        );
    }

    function _sharesFor(
        uint _amount,
        uint _preMintSupply,
        uint _netAssetValue
    ) internal pure returns (uint) {
        return _preMintSupply == 0 ? _amount * SHARE_PRECISION : Math.mulDiv(_amount, _preMintSupply, _netAssetValue);
    }
}
