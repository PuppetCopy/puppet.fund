// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "solady/utils/ECDSA.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

import {AccountLib} from "../utils/AccountLib.sol";
import {BalanceLib} from "../utils/BalanceLib.sol";
import {CallLib} from "../utils/CallLib.sol";
import {Error} from "../utils/Error.sol";
import {IAccount} from "../utils/interfaces/IAccount.sol";
import {DepositRoute} from "./DepositRoute.sol";

contract Account is IAccount {
    struct Body {
        address module;
        address user;
        address signer;
        uint64 nonce;
    }

    bytes32 internal immutable SLOT;

    constructor() {
        SLOT = keccak256(abi.encode("puppet.account", address(this)));
    }

    function nonce() public view returns (uint) {
        return _body().nonce;
    }

    function args() public view returns (address, address, address) {
        Body storage _b = _body();
        return (_b.module, _b.user, _b.signer);
    }

    function isValidSignature(
        bytes32 _digest,
        bytes calldata _signature
    ) public view returns (bytes4) {
        if (ECDSA.tryRecoverCalldata(_digest, _signature) != address(this)) return 0xffffffff;
        return IERC1271.isValidSignature.selector;
    }

    function genesis(
        address _user,
        address _signer,
        bytes calldata _keySignature
    ) external returns (bytes32 digest_) {
        Body storage _b = _body();
        if (_b.nonce != 0) revert Error.Account__AlreadyCreated();
        if (_user == address(0) || _signer == address(0)) revert Error.Account__InvalidUser();
        digest_ = AccountLib.genesisDigest(msg.sender, address(this), _user, _signer);
        if (ECDSA.tryRecoverCalldata(digest_, _keySignature) != address(this)) {
            revert Error.Account__InvalidSignature();
        }
        _b.module = msg.sender;
        _b.user = _user;
        _b.signer = _signer;
        _b.nonce = 1;
    }

    function execute(
        address _attestor,
        bytes32 _digest,
        bytes calldata _signature,
        IAccount.Call[] calldata _callList
    ) external payable returns (bytes[] memory resultList_) {
        Body storage _b = _body();
        if (msg.sender != _b.module) revert Error.Account__UnauthorizedCaller();
        if (
            _signature.length < 130 || ECDSA.tryRecoverCalldata(_digest, _signature[:65]) != _b.signer
                || !SignatureCheckerLib.isValidSignatureNowCalldata(_attestor, _digest, _signature[65:])
        ) revert Error.Account__InvalidSignature();

        uint64 _expected;
        unchecked {
            _expected = _b.nonce + 1;
        }
        _b.nonce = _expected;

        uint _callLen = _callList.length;
        resultList_ = new bytes[](_callLen);
        for (uint _i; _i < _callLen; ++_i) {
            IAccount.Call calldata _call = _callList[_i];
            if (_call.target == address(this) || _call.target == msg.sender) {
                revert Error.Account__ForbiddenTarget(_call.target);
            }
            bool _ok;
            (_ok, resultList_[_i]) = _call.target
            .call{value: _call.value, gas: _call.gasLimit > 0 ? _call.gasLimit : gasleft()}(
                _call.callData
            );
            if (!_ok) {
                bytes memory _res = resultList_[_i];
                assembly ("memory-safe") {
                    revert(add(_res, 32), mload(_res))
                }
            }
        }
        if (_b.nonce != _expected) revert Error.Account__ReentrantCall();
    }

    function forcedWithdrawal(
        address _route,
        address _token,
        uint _amount,
        address _to
    ) external returns (IAccount.Call[] memory callList_, bytes[] memory resultList_) {
        if (msg.sender != _body().module) revert Error.Account__UnauthorizedCaller();
        uint _atRoute = BalanceLib.balanceOf(_token, _route);
        callList_ = new IAccount.Call[](_atRoute > 0 ? 2 : 1);
        uint _at;
        if (_atRoute > 0) {
            IAccount.Call[] memory _inner = new IAccount.Call[](1);
            _inner[0] = CallLib.pay(_token, _to, _atRoute, 0);
            callList_[0] = IAccount.Call({
                target: _route, value: 0, gasLimit: 0, callData: abi.encodeCall(DepositRoute.execute, (_inner))
            });
            _at = 1;
        }
        callList_[_at] = CallLib.pay(_token, _to, _amount, 0);

        uint _callLen = callList_.length;
        resultList_ = new bytes[](_callLen);
        for (uint _i; _i < _callLen; ++_i) {
            bool _ok;
            (_ok, resultList_[_i]) = callList_[_i].target.call{value: callList_[_i].value}(callList_[_i].callData);
            if (!_ok) {
                bytes memory _res = resultList_[_i];
                assembly ("memory-safe") {
                    revert(add(_res, 32), mload(_res))
                }
            }
        }
    }

    function _body() internal view returns (Body storage b_) {
        bytes32 _slot = SLOT;
        assembly ("memory-safe") {
            b_.slot := _slot
        }
    }

    receive() external payable {}
}
