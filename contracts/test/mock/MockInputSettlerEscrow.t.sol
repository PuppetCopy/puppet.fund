// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {StandardOrder, MandateOutput} from "src/utils/interfaces/IInputSettlerEscrow.sol";

contract MockInputSettlerEscrow {
    address public lastUser;
    address public lastInputToken;
    uint public lastInputAmount;
    address public lastOutputToken;
    uint public lastOutputAmount;
    address public lastRecipient;
    uint public lastDestinationChainId;
    uint public openCount;

    function open(
        StandardOrder calldata order
    ) external {
        address inputToken = address(uint160(order.inputs[0][0]));
        uint inputAmount = order.inputs[0][1];
        SafeERC20.safeTransferFrom(IERC20(inputToken), msg.sender, address(this), inputAmount);
        MandateOutput calldata out = order.outputs[0];
        lastUser = order.user;
        lastInputToken = inputToken;
        lastInputAmount = inputAmount;
        lastOutputToken = address(uint160(uint(out.token)));
        lastOutputAmount = out.amount;
        lastRecipient = address(uint160(uint(out.recipient)));
        lastDestinationChainId = out.chainId;
        openCount++;
    }

    function refund(
        StandardOrder calldata order
    ) external {
        SafeERC20.safeTransfer(IERC20(address(uint160(order.inputs[0][0]))), order.user, order.inputs[0][1]);
    }
}
