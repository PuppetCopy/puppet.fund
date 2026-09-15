// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockVenue {
    function release(
        address _token,
        address _to,
        uint _amount
    ) external {
        SafeERC20.safeTransfer(IERC20(_token), _to, _amount);
    }
}
