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
import {Error} from "../utils/Error.sol";
import {IAuthority} from "../utils/interfaces/IAuthority.sol";
import {ShareToken} from "./ShareToken.sol";
import {ShareLib} from "../utils/ShareLib.sol";

bytes32 constant ALLOCATE_INTENT_TYPEHASH = keccak256(
    "AllocateIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,ShareInitParams share,uint256 acceptableNetAssetValue,uint256 totalShareSupply,uint256 masterAmount,bytes32 puppetListHash,bytes32 matchedAmountListHash)AccountInitParams(address user,address signer)ShareInitParams(address master,bytes32 baseTokenId,bytes32 name)"
);

uint constant SHARE_PRECISION = 1e12;

contract Allocate is Access {
    struct AllocateIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        ShareLib.ShareInitParams share;
        uint acceptableNetAssetValue;
        uint totalShareSupply;
        uint masterAmount;
        address[] puppetList;
        uint[] matchedAmountList;
    }

    constructor(
        IAuthority _authority
    ) Access(_authority) {}

    function _sharesFor(
        uint _amount,
        uint _preMintSupply,
        uint _netAssetValue
    ) internal pure returns (uint) {
        return _preMintSupply == 0 ? _amount * SHARE_PRECISION : Math.mulDiv(_amount, _preMintSupply, _netAssetValue);
    }

    function allocate(
        AllocateIntent calldata _intent,
        bytes[] calldata _bodyList,
        bytes[] calldata _mandateList,
        Account _accountGate,
        Issue _shareGate,
        AllocateStore _store,
        RedeemStore _redeemStore,
        IERC20 _base,
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
        if (_bodyList.length != _n || _mandateList.length != _n || _intent.matchedAmountList.length != _n) {
            revert Error.Allocate__ListLengthMismatch(_n, _bodyList.length, _mandateList.length);
        }

        address _fundAccount = _accountGate.predictFundAccount(_intent.share.master);
        if (_fundAccount.code.length == 0) _accountGate.createFundAccount(_intent.share.master);
        ShareToken _shareToken = ShareToken(_shareGate.predict(_intent.share));
        uint _preMintSupply;
        if (address(_shareToken).code.length == 0) {
            _shareGate.createShareToken(_intent.share);
        } else {
            _preMintSupply = _shareToken.totalSupply();
            if (_preMintSupply == 0 && _redeemStore.getPool(_fundAccount).totalStake != 0) {
                revert Error.Share__Empty();
            }
        }
        if (_preMintSupply != _intent.totalShareSupply) {
            revert Error.Allocate__PreMintSupplyMismatch(_preMintSupply, _intent.totalShareSupply);
        }

        uint[] memory _puppetSharesMintedList = new uint[](_n);
        uint _totalMatched;
        uint _totalPuppetMinted;

        AllocateStore.PuppetState[] memory _stateList = _store.getPuppetStateList(_intent.puppetList, _fundAccount);
        for (uint _i; _i < _n; ++_i) {
            address _puppet = _intent.puppetList[_i];
            if (_i > 0 && uint160(_puppet) <= uint160(_intent.puppetList[_i - 1])) {
                revert Error.Allocate__PuppetListNotSorted(_intent.puppetList[_i - 1], _puppet);
            }
            uint _amount = _intent.matchedAmountList[_i];
            if (_amount == 0) continue;

            bytes calldata _body = _bodyList[_i];
            (bytes32 _bodyHash, bytes32 _mandateDigest) =
                RuleLib.mandate(_routerDomainSeparator, _puppet, _fundAccount, _base, _body);
            if (_stateList[_i].mandate != _bodyHash) continue;
            uint _lastAllocatedAt = _stateList[_i].lastAllocatedAt;
            uint _throttle = RuleLib.throttlePeriod(_body);
            if (_throttle > type(uint).max - _lastAllocatedAt || block.timestamp < _lastAllocatedAt + _throttle) {
                continue;
            }
            uint _rateLimit = RuleLib.rateLimit(_body);
            if (_rateLimit != 0 && _amount > _rateLimit) _amount = _rateLimit;

            uint _sa = _sharesFor(_amount, _preMintSupply, _intent.acceptableNetAssetValue);
            if (_sa == 0) continue;

            try _accountGate.dispatchMandate(
                IAccount(_puppet),
                _mandateDigest,
                _mandateList[_i],
                CallLib.wrap(CallLib.transferCall(_base, _fundAccount, _amount, _transferGasLimit)),
                CallLib.signTransfer(_intent.share.baseTokenId, _base, 0, _amount)
            ) returns (
                uint[] memory, uint[] memory, bytes[] memory
            ) {
                _puppetSharesMintedList[_i] = _sa;
                _totalPuppetMinted += _sa;
                _totalMatched += _amount;
            } catch {
                continue;
            }
        }

        uint _ownerNewShares;
        uint _masterIn = _intent.masterAmount;
        if (_masterIn > 0) {
            _ownerNewShares = _sharesFor(_masterIn, _preMintSupply, _intent.acceptableNetAssetValue);
            if (_ownerNewShares == 0) _masterIn = 0;
        }

        fundAccountIn_ = _masterIn + _totalMatched;
        if (fundAccountIn_ == 0) revert Error.Allocate__ZeroAmount();

        if (_masterIn > 0) {
            _accountGate.dispatch(
                IAccount(_intent.share.master),
                CallLib.wrap(
                    CallLib.routeDeposit(
                        _accountGate.predictRoute(_intent.share.master),
                        _base,
                        _fundAccount,
                        _masterIn,
                        _transferGasLimit
                    )
                ),
                CallLib.noTransfers(),
                _digest,
                _userSignature,
                _attestorSignature,
                _attestor,
                _intent.nonce
            );
        }
        _accountGate.dispatch(
            IAccount(_fundAccount),
            CallLib.feeOnly(_base, _feeReceiver, _actualRelayFee, _transferGasLimit),
            CallLib.noTransfers(),
            _digest,
            _userSignature,
            _attestorSignature,
            _attestor,
            _intent.nonce
        );

        if (_ownerNewShares > 0) _shareGate.mint(_shareToken, _intent.share.master, _ownerNewShares);
        if (_totalPuppetMinted > 0) {
            _shareGate.mintMany(_shareToken, _intent.puppetList, _puppetSharesMintedList);
            _store.setLastAllocatedAtMany(_intent.puppetList, _puppetSharesMintedList, _fundAccount, block.timestamp);
        }

        _logEvent(
            "Allocate",
            abi.encode(
                _intent,
                _fundAccount,
                _ownerNewShares,
                _puppetSharesMintedList,
                _totalMatched,
                _preMintSupply + _ownerNewShares + _totalPuppetMinted
            )
        );
    }
}
