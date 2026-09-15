// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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
}
