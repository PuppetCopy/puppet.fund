// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IAccount} from "../core/interface/IAccount.sol";

library CallLib {
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
}
