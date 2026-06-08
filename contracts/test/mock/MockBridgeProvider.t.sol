// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockBridgeProvider {
    address public lastUser;
    address public lastInputToken;
    uint public lastInputAmount;
    address public lastOutputToken;
    uint public lastOutputAmount;
    address public lastRecipient;
    uint public lastDestinationChainId;
    uint public openCount;

    function fill(
        address inputToken,
        uint inputAmount,
        address outputToken,
        uint outputAmount,
        address recipient,
        uint destinationChainId
    ) external {
        SafeERC20.safeTransferFrom(IERC20(inputToken), msg.sender, address(this), inputAmount);
        lastUser = msg.sender;
        lastInputToken = inputToken;
        lastInputAmount = inputAmount;
        lastOutputToken = outputToken;
        lastOutputAmount = outputAmount;
        lastRecipient = recipient;
        lastDestinationChainId = destinationChainId;
        openCount++;
    }
}
