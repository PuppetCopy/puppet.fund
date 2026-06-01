// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {LibClone} from "solady/utils/LibClone.sol";

import {Error} from "../utils/Error.sol";
import {IAccount} from "./interface/IAccount.sol";

contract TransientRoute {
    function account() public view returns (address _a) {
        bytes memory _b = LibClone.argsOnClone(address(this), 0, 20);
        assembly ("memory-safe") {
            _a := shr(96, mload(add(_b, 0x20)))
        }
    }

    function execute(
        IAccount.Call[] calldata _callList
    ) external payable returns (bytes[] memory _returnData) {
        if (msg.sender != account()) revert Error.TransientRoute__Unauthorized();
        uint _len = _callList.length;
        _returnData = new bytes[](_len);
        for (uint _i; _i < _len; ++_i) {
            IAccount.Call calldata _exec = _callList[_i];
            (bool _ok, bytes memory _result) = _exec.gasLimit > 0
                ? _exec.target.call{value: _exec.value, gas: _exec.gasLimit}(_exec.callData)
                : _exec.target.call{value: _exec.value}(_exec.callData);
            if (!_ok) {
                assembly ("memory-safe") {
                    revert(add(_result, 32), mload(_result))
                }
            }
            _returnData[_i] = _result;
        }
    }

    receive() external payable {}
}
