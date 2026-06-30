// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockSwapProvider {
    uint public swapCount;

    function swap(
        address inputToken,
        uint inputAmount,
        address outputToken,
        uint outputAmount,
        address recipient
    ) external {
        SafeERC20.safeTransferFrom(IERC20(inputToken), msg.sender, address(this), inputAmount);
        SafeERC20.safeTransfer(IERC20(outputToken), recipient, outputAmount);
        swapCount++;
    }
}
