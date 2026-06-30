// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IAccount} from "./interfaces/IAccount.sol";
import {NATIVE_TOKEN} from "./Native.sol";
import {Route} from "../core/Route.sol";

library CallLib {
    function transfer(
        address _token,
        address _to,
        uint _amount,
        uint _gasLimit
    ) internal pure returns (IAccount.Call memory) {
        return IAccount.Call({
            target: _token,
            value: 0,
            gasLimit: _gasLimit,
            callData: abi.encodeCall(IERC20.transfer, (_to, _amount))
        });
    }

    // an empty call with value set, vs an ERC20.transfer encoding.
    function transferValue(address _to, uint _amount, uint _gasLimit) internal pure returns (IAccount.Call memory) {
        return IAccount.Call({target: _to, value: _amount, gasLimit: _gasLimit, callData: ""});
    }

    function payout(
        address _token,
        address _to,
        uint _amount,
        uint _gasLimit
    ) internal pure returns (IAccount.Call memory) {
        return _token == NATIVE_TOKEN
            ? transferValue(_to, _amount, _gasLimit)
            : transfer(_token, _to, _amount, _gasLimit);
    }

    function approve(
        address _token,
        address _spender,
        uint _amount,
        uint _gasLimit
    ) internal pure returns (IAccount.Call memory) {
        return IAccount.Call({
            target: _token,
            value: 0,
            gasLimit: _gasLimit,
            callData: abi.encodeCall(IERC20.approve, (_spender, _amount))
        });
    }

    function fee(
        address _feeToken,
        address _feeReceiver,
        uint _amount,
        uint _gasLimit
    ) internal pure returns (IAccount.Call memory) {
        return payout(_feeToken, _feeReceiver, _amount, _gasLimit);
    }

    function routeExecute(
        address _route,
        IAccount.Call[] memory _legs
    ) internal pure returns (IAccount.Call memory) {
        return IAccount.Call({target: _route, value: 0, gasLimit: 0, callData: abi.encodeCall(Route.execute, (_legs))});
    }

    function compose(
        IAccount.Call memory _a
    ) internal pure returns (IAccount.Call[] memory _list) {
        _list = new IAccount.Call[](1);
        _list[0] = _a;
    }

    function compose(
        IAccount.Call memory _a,
        IAccount.Call memory _b
    ) internal pure returns (IAccount.Call[] memory _list) {
        _list = new IAccount.Call[](2);
        _list[0] = _a;
        _list[1] = _b;
    }

    function compose(
        IAccount.Call memory _a,
        IAccount.Call memory _b,
        IAccount.Call memory _c
    ) internal pure returns (IAccount.Call[] memory _list) {
        _list = new IAccount.Call[](3);
        _list[0] = _a;
        _list[1] = _b;
        _list[2] = _c;
    }

    function compose(
        IAccount.Call memory _a,
        IAccount.Call memory _b,
        IAccount.Call memory _c,
        IAccount.Call memory _d
    ) internal pure returns (IAccount.Call[] memory _list) {
        _list = new IAccount.Call[](4);
        _list[0] = _a;
        _list[1] = _b;
        _list[2] = _c;
        _list[3] = _d;
    }

    function compose(
        IAccount.Call memory _a,
        IAccount.Call memory _b,
        IAccount.Call memory _c,
        IAccount.Call memory _d,
        IAccount.Call memory _e
    ) internal pure returns (IAccount.Call[] memory _list) {
        _list = new IAccount.Call[](5);
        _list[0] = _a;
        _list[1] = _b;
        _list[2] = _c;
        _list[3] = _d;
        _list[4] = _e;
    }

    function empty() internal pure returns (IAccount.Call[] memory) {
        return new IAccount.Call[](0);
    }

    function feeOnly(
        address _feeToken,
        address _feeReceiver,
        uint _amount,
        uint _gasLimit
    ) internal pure returns (IAccount.Call[] memory) {
        return _amount > 0 ? compose(fee(_feeToken, _feeReceiver, _amount, _gasLimit)) : empty();
    }
}
