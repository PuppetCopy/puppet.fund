// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {LibClone} from "solady/utils/LibClone.sol";

import {AccountModule} from "./AccountModule.sol";
import {Error} from "../utils/Error.sol";
import {IAccount} from "../utils/interfaces/IAccount.sol";

contract DepositRoute {
    function user() public view returns (address user_) {
        bytes memory _b = LibClone.argsOnClone(address(this), 0, 20);
        assembly ("memory-safe") {
            user_ := shr(96, mload(add(_b, 0x20)))
        }
    }

    function module() public view returns (address module_) {
        bytes memory _b = LibClone.argsOnClone(address(this), 20, 40);
        assembly ("memory-safe") {
            module_ := shr(96, mload(add(_b, 0x20)))
        }
    }

    function execute(
        IAccount.Call[] calldata _callList
    ) external payable returns (bytes[] memory resultList_) {
        if (msg.sender != user()) {
            address _user = AccountModule(module()).userOf(msg.sender);
            if (_user != user()) revert Error.Account__UnauthorizedCaller();
        }

        uint _callLen = _callList.length;
        resultList_ = new bytes[](_callLen);
        for (uint _i; _i < _callLen; ++_i) {
            IAccount.Call calldata _call = _callList[_i];
            if (_call.target == address(this)) revert Error.Account__ForbiddenTarget(_call.target);
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
    }

    receive() external payable {}
}
