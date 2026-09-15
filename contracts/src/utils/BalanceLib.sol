// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NATIVE_TOKEN} from "./Native.sol";

library BalanceLib {
    function balanceOf(
        address _token,
        address _account
    ) internal view returns (uint) {
        return _token == NATIVE_TOKEN ? _account.balance : IERC20(_token).balanceOf(_account);
    }
}
