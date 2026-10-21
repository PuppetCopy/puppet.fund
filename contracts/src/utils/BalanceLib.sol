// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NATIVE_TOKEN} from "./Native.sol";

library BalanceLib {
    struct Balance {
        address token;
        uint amount;
    }

    function balanceOf(
        address _token,
        address _account
    ) internal view returns (uint) {
        return _token == NATIVE_TOKEN ? _account.balance : IERC20(_token).balanceOf(_account);
    }

    function list(
        address _token
    ) internal pure returns (address[] memory list_) {
        list_ = new address[](1);
        list_[0] = _token;
    }

    function list(
        address _a,
        address _b
    ) internal pure returns (address[] memory list_) {
        if (_a == _b) return list(_a);
        list_ = new address[](2);
        list_[0] = _a;
        list_[1] = _b;
    }

    function list(
        address _a,
        address _b,
        address _c
    ) internal pure returns (address[] memory list_) {
        if (_c == _a || _c == _b) return list(_a, _b);
        if (_a == _b) return list(_a, _c);
        list_ = new address[](3);
        list_[0] = _a;
        list_[1] = _b;
        list_[2] = _c;
    }
}
