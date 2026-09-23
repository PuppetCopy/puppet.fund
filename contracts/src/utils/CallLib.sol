// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

import {UserAccount} from "../core/UserAccount.sol";
import {Error} from "./Error.sol";
import {IAccount} from "./interfaces/IAccount.sol";
import {NATIVE_TOKEN} from "./Native.sol";

library CallLib {
    function pay(
        address _token,
        address _to,
        uint _amount,
        uint _gasLimit
    ) internal pure returns (IAccount.Call memory) {
        return _token == NATIVE_TOKEN
            ? IAccount.Call({target: _to, value: _amount, gasLimit: _gasLimit, callData: ""})
            : IAccount.Call({
                target: _token,
                value: 0,
                gasLimit: _gasLimit,
                callData: abi.encodeCall(IERC20.transfer, (_to, _amount))
            });
    }

    function verifyPair(
        address _approver,
        address _attestor,
        bytes32 _digest,
        bytes calldata _coSig
    ) internal view {
        if (_coSig.length < 130) revert Error.Account__InvalidSignature();
        uint _split = _coSig.length - 65;
        if (
            !UserAccount(payable(_approver)).approves(_digest, _coSig[:_split])
                || !SignatureCheckerLib.isValidSignatureNowCalldata(_attestor, _digest, _coSig[_split:])
        ) revert Error.Account__InvalidSignature();
    }

    function run(
        IAccount.Call[] calldata _callList,
        address _module
    ) internal returns (bytes[] memory resultList_) {
        uint _callLen = _callList.length;
        resultList_ = new bytes[](_callLen);
        for (uint _i; _i < _callLen; ++_i) {
            IAccount.Call calldata _call = _callList[_i];
            if (_call.target == _module) revert Error.Account__ForbiddenTarget(_call.target);
            bool _ok;
            (_ok, resultList_[_i]) = _call.target
            .call{value: _call.value, gas: _call.gasLimit > 0 ? _call.gasLimit : gasleft()}(
                _call.callData
            );
            bytes memory _res = resultList_[_i];
            if (!_ok) {
                assembly ("memory-safe") {
                    revert(add(_res, 32), mload(_res))
                }
            }
            if (_res.length == 32 && _call.callData.length >= 4) {
                bytes4 _selector = bytes4(_call.callData[:4]);
                if (
                    (_selector == IERC20.transfer.selector || _selector == IERC20.approve.selector)
                        && abi.decode(_res, (uint)) != 1
                ) revert Error.Account__CallReturnedFalse(_call.target);
            }
        }
    }
}
