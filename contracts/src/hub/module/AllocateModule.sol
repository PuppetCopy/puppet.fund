// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IAccount} from "../../core/interface/IAccount.sol";
import {AccountLib} from "../../core/AccountLib.sol";
import {AccountModule} from "../../core/module/AccountModule.sol";
import {ShareModule} from "../ShareModule.sol";
import {RuleLib} from "../RuleLib.sol";
import {AllocateStore} from "../AllocateStore.sol";
import {Access} from "../../utils/auth/Access.sol";
import {Error} from "../../utils/Error.sol";
import {IAuthority} from "../../utils/interfaces/IAuthority.sol";
import {ShareToken} from "../ShareToken.sol";
import {TransientRoute} from "../../core/TransientRoute.sol";

bytes32 constant ALLOCATE_INTENT_TYPEHASH = keccak256(
    "AllocateIntent(AccountInitParams params,uint256 blockNumber,uint256 deadline,uint256 acceptableRelayFee,uint256 nonce,uint256 chainId,address baseToken,uint256 acceptableNetAssetValue,uint256 totalShareSupply,uint256 masterAmount,bytes32 puppetListHash,bytes32 matchedAmountListHash)AccountInitParams(address user,bytes32 name,bytes32 baseTokenId,address signer)"
);

contract AllocateModule is Access {
    struct AllocateIntent {
        AccountLib.AccountInitParams params;
        uint blockNumber;
        uint deadline;
        uint acceptableRelayFee;
        uint nonce;
        uint chainId;
        IERC20 baseToken;
        uint acceptableNetAssetValue;
        uint totalShareSupply;
        uint masterAmount;
        address[] puppetList;
        uint[] matchedAmountList;
    }

    constructor(
        IAuthority _authority
    ) Access(_authority) {}

    function allocate(
        AllocateIntent calldata _intent,
        bytes[] calldata _bodyList,
        bytes[] calldata _mandateList,
        AccountModule _accountGate,
        ShareModule _shareGate,
        AllocateStore _store,
        bytes32 _digest,
        bytes32 _routerDomainSeparator,
        bytes calldata _userSignature,
        bytes calldata _attestorSignature,
        address _attestor,
        uint _transferGasLimit,
        address _feeReceiver,
        uint _actualRelayFee
    ) external auth returns (uint masterAccountIn_) {
        if (_intent.acceptableNetAssetValue == 0) revert Error.Allocate__ZeroAcceptableNav();
        uint _n = _intent.puppetList.length;
        if (_bodyList.length != _n || _mandateList.length != _n || _intent.matchedAmountList.length != _n) {
            revert Error.Allocate__ListLengthMismatch(_n, _bodyList.length, _mandateList.length);
        }

        address _masterAccount = address(_accountGate.verifyMasterAccount(_intent.params));
        ShareToken _shareToken = ShareToken(_shareGate.predict(_masterAccount));
        uint _preMintSupply = _shareToken.totalSupply();
        if (_preMintSupply == 0 && _store.seeded(_masterAccount)) revert Error.Share__Empty();
        if (_preMintSupply != _intent.totalShareSupply) {
            revert Error.Allocate__PreMintSupplyMismatch(_preMintSupply, _intent.totalShareSupply);
        }

        uint[] memory _puppetSharesMintedList = new uint[](_n);
        uint _totalMatched;
        uint _totalPuppetMinted;

        AllocateStore.PuppetState[] memory _stateList = _store.getPuppetStateList(_intent.puppetList, _masterAccount);
        IAccount.Call[] memory _transferList = new IAccount.Call[](1);
        for (uint _i; _i < _n; ++_i) {
            address _puppet = _intent.puppetList[_i];
            if (_i > 0 && uint160(_puppet) <= uint160(_intent.puppetList[_i - 1])) {
                revert Error.Allocate__PuppetListNotSorted(_intent.puppetList[_i - 1], _puppet);
            }
            uint _amount = _intent.matchedAmountList[_i];
            if (_amount == 0) continue;

            bytes calldata _body = _bodyList[_i];
            (bytes32 _bodyHash, bytes32 _mandateDigest) =
                RuleLib.mandate(_routerDomainSeparator, _puppet, _masterAccount, _intent.baseToken, _body);
            if (_stateList[_i].mandate != _bodyHash) continue;
            if (block.timestamp < _stateList[_i].lastAllocatedAt + RuleLib.throttlePeriod(_body)) continue;
            uint _rateLimit = RuleLib.rateLimit(_body);
            if (_rateLimit != 0 && _amount > _rateLimit) _amount = _rateLimit;

            uint _sa = _preMintSupply == 0
                ? _amount
                : Math.mulDiv(_amount, _preMintSupply, _intent.acceptableNetAssetValue);
            if (_sa == 0) continue;

            _transferList[0] = IAccount.Call({
                target: address(_intent.baseToken),
                value: 0,
                gasLimit: _transferGasLimit,
                callData: abi.encodeCall(IERC20.transfer, (_masterAccount, _amount))
            });
            try _accountGate.dispatchMandate(
                IAccount(_puppet),
                _mandateDigest,
                _mandateList[_i],
                _transferList,
                _intent.baseToken,
                _amount,
                _transferGasLimit
            ) returns (uint, uint, bytes[] memory) {
                _puppetSharesMintedList[_i] = _sa;
                _totalPuppetMinted += _sa;
                _totalMatched += _amount;
            } catch {
                continue;
            }
        }

        uint _ownerNewShares;
        if (_intent.masterAmount > 0) {
            _ownerNewShares = _preMintSupply == 0
                ? _intent.masterAmount
                : Math.mulDiv(_intent.masterAmount, _preMintSupply, _intent.acceptableNetAssetValue);
            if (_ownerNewShares == 0) revert Error.Allocate__ZeroSharesMinted(_intent.params.user, _intent.masterAmount);
        }

        masterAccountIn_ = _intent.masterAmount + _totalMatched;
        if (masterAccountIn_ == 0) revert Error.Allocate__ZeroAmount();
        if (_preMintSupply == 0) _store.setSeeded(_masterAccount);

        IAccount.Call[] memory _calls = new IAccount.Call[](0);
        if (_intent.masterAmount > 0) {
            IAccount.Call[] memory _seedCall = new IAccount.Call[](1);
            _seedCall[0] = IAccount.Call({
                target: address(_intent.baseToken),
                value: 0,
                gasLimit: _transferGasLimit,
                callData: abi.encodeCall(IERC20.transfer, (_masterAccount, _intent.masterAmount))
            });
            _calls = new IAccount.Call[](1);
            _calls[0] = IAccount.Call({
                target: _accountGate.predictTransientRoute(_masterAccount),
                value: 0,
                gasLimit: 0,
                callData: abi.encodeCall(TransientRoute.execute, (_seedCall))
            });
        }
        _accountGate.dispatch(
            IAccount(_masterAccount),
            _calls,
            _digest,
            _userSignature,
            _attestorSignature,
            _attestor,
            _intent.nonce,
            _intent.baseToken,
            masterAccountIn_,
            0,
            _actualRelayFee,
            _feeReceiver,
            _transferGasLimit
        );

        if (_ownerNewShares > 0) _shareGate.mint(_shareToken, _masterAccount, _ownerNewShares);
        if (_totalPuppetMinted > 0) {
            _shareGate.mintMany(_shareToken, _intent.puppetList, _puppetSharesMintedList);
            _store.setLastAllocatedAtMany(_intent.puppetList, _puppetSharesMintedList, _masterAccount, block.timestamp);
        }

        _logEvent(
            "Allocate",
            abi.encode(
                _intent,
                _masterAccount,
                _ownerNewShares,
                _puppetSharesMintedList,
                _totalMatched,
                _preMintSupply + _ownerNewShares + _totalPuppetMinted
            )
        );
    }
}
