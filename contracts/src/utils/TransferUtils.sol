// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Error} from "./Error.sol";

library TransferUtils {
    function transferStrictly(
        uint _gasLimit,
        IERC20 _token,
        address _to,
        uint _amount
    ) internal {
        if (_amount == 0) return;
        if (_to == address(0)) revert Error.TransferUtils__InvalidReceiver();
        if (!_callOptionalReturnBool(_gasLimit, _token, abi.encodeCall(_token.transfer, (_to, _amount)))) {
            revert Error.TransferUtils__TokenTransferError(_token, _to, _amount);
        }
    }

    function transferStrictlyFrom(
        uint _gasLimit,
        IERC20 _token,
        address _from,
        address _to,
        uint _amount
    ) internal {
        if (_amount == 0) return;
        if (_to == address(0)) revert Error.TransferUtils__InvalidReceiver();
        if (!_callOptionalReturnBool(_gasLimit, _token, abi.encodeCall(_token.transferFrom, (_from, _to, _amount)))) {
            revert Error.TransferUtils__TokenTransferFromError(_token, _from, _to, _amount);
        }
    }

    function _callOptionalReturnBool(
        uint _gasLimit,
        IERC20 _token,
        bytes memory _data
    ) private returns (bool) {
        if (_gasLimit == 0) revert Error.TransferUtils__EmptyTokenTransferGasLimit(_token);
        bool _success;
        uint _returnSize;
        uint _returnValue;
        assembly ("memory-safe") {
            _success := call(_gasLimit, _token, 0, add(_data, 0x20), mload(_data), 0, 0x20)
            _returnSize := returndatasize()
            _returnValue := mload(0)
        }
        return _success && (_returnSize == 0 ? address(_token).code.length > 0 : _returnValue == 1);
    }
}
