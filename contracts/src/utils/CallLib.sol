// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IAccount} from "./interfaces/IAccount.sol";
import {Route} from "../core/Route.sol";

library CallLib {
    function wrap(
        IAccount.Call memory _call
    ) internal pure returns (IAccount.Call[] memory _callList) {
        _callList = new IAccount.Call[](1);
        _callList[0] = _call;
    }

    function signTransfer(
        bytes32 _tokenId,
        IERC20 _token,
        uint _amountIn,
        uint _amountOut
    ) internal pure returns (IAccount.SignTransfer[] memory _transferList) {
        _transferList = new IAccount.SignTransfer[](1);
        _transferList[0] =
            IAccount.SignTransfer({tokenId: _tokenId, token: _token, amountIn: _amountIn, amountOut: _amountOut});
    }

    function noTransfers() internal pure returns (IAccount.SignTransfer[] memory) {
        return new IAccount.SignTransfer[](0);
    }

    function withFee(
        IAccount.Call memory _call,
        IERC20 _feeToken,
        address _feeReceiver,
        uint _fee,
        uint _gasLimit
    ) internal pure returns (IAccount.Call[] memory _callList) {
        _callList = new IAccount.Call[](_fee > 0 ? 2 : 1);
        _callList[0] = _call;
        if (_fee > 0) _callList[1] = feeCall(_feeToken, _feeReceiver, _fee, _gasLimit);
    }

    function feeOnly(
        IERC20 _feeToken,
        address _feeReceiver,
        uint _fee,
        uint _gasLimit
    ) internal pure returns (IAccount.Call[] memory _callList) {
        _callList = new IAccount.Call[](_fee > 0 ? 1 : 0);
        if (_fee > 0) _callList[0] = feeCall(_feeToken, _feeReceiver, _fee, _gasLimit);
    }

    function feeCall(
        IERC20 _feeToken,
        address _feeReceiver,
        uint _fee,
        uint _gasLimit
    ) internal pure returns (IAccount.Call memory) {
        return address(_feeToken) == address(0)
            ? IAccount.Call({target: _feeReceiver, value: _fee, gasLimit: _gasLimit, callData: ""})
            : transferCall(_feeToken, _feeReceiver, _fee, _gasLimit);
    }

    function transferCall(
        IERC20 _token,
        address _to,
        uint _amount,
        uint _gasLimit
    ) internal pure returns (IAccount.Call memory) {
        return IAccount.Call({
            target: address(_token),
            value: 0,
            gasLimit: _gasLimit,
            callData: abi.encodeCall(IERC20.transfer, (_to, _amount))
        });
    }

    function approveCall(
        IERC20 _token,
        address _spender,
        uint _amount,
        uint _gasLimit
    ) internal pure returns (IAccount.Call memory) {
        return IAccount.Call({
            target: address(_token),
            value: 0,
            gasLimit: _gasLimit,
            callData: abi.encodeCall(IERC20.approve, (_spender, _amount))
        });
    }

    function routeExecute(
        address _route,
        IAccount.Call[] memory _legs
    ) internal pure returns (IAccount.Call memory) {
        return IAccount.Call({target: _route, value: 0, gasLimit: 0, callData: abi.encodeCall(Route.execute, (_legs))});
    }

    function routeDeposit(
        address _route,
        IERC20 _token,
        address _recipient,
        uint _amount,
        uint _gasLimit
    ) internal pure returns (IAccount.Call memory) {
        return routeExecute(_route, wrap(transferCall(_token, _recipient, _amount, _gasLimit)));
    }
}
