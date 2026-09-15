// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Error} from "./Error.sol";
import {NATIVE_TOKEN} from "./Native.sol";

library TransferUtils {
    function transferStrictly(
        address _token,
        address _to,
        uint _amount,
        uint _gasLimit
    ) internal {
        if (_amount == 0) revert Error.Balance__ZeroAmount();
        if (_to == address(0)) revert Error.TransferUtils__InvalidReceiver();
        if (_gasLimit == 0) revert Error.TransferUtils__EmptyTokenTransferGasLimit(IERC20(_token));
        if (_token == NATIVE_TOKEN) {
            (bool _ok,) = _to.call{value: _amount, gas: _gasLimit}("");
            if (!_ok) revert Error.TransferUtils__NativeTransferError(_to, _amount);
            return;
        }
        if (!_callOptionalReturnBool(IERC20(_token), abi.encodeCall(IERC20.transfer, (_to, _amount)), _gasLimit)) {
            revert Error.TransferUtils__TokenTransferError(IERC20(_token), _to, _amount);
        }
    }

    function transferStrictlyFrom(
        IERC20 _token,
        address _from,
        address _to,
        uint _amount,
        uint _gasLimit
    ) internal {
        if (_amount == 0) revert Error.Balance__ZeroAmount();
        if (_to == address(0)) revert Error.TransferUtils__InvalidReceiver();
        if (_gasLimit == 0) revert Error.TransferUtils__EmptyTokenTransferGasLimit(_token);
        if (!_callOptionalReturnBool(_token, abi.encodeCall(_token.transferFrom, (_from, _to, _amount)), _gasLimit)) {
            revert Error.TransferUtils__TokenTransferFromError(_token, _from, _to, _amount);
        }
    }

    function _callOptionalReturnBool(
        IERC20 _token,
        bytes memory _data,
        uint _gasLimit
    ) private returns (bool) {
        bool _success;
        uint _returnSize;
        uint _returnValue;
        assembly ("memory-safe") {
            _success := call(_gasLimit, _token, 0, add(_data, 0x20), mload(_data), 0, 0x20)
            _returnSize := returndatasize()
            _returnValue := mload(0)
        }
        return _success && (_returnSize == 0 ? address(_token).code.length > 0 : _returnSize == 32 && _returnValue == 1);
    }
}
