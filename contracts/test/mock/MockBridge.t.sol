// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockBridge {
    uint public bridged;
    uint public destinationChainId;
    address public recipient;

    function send(
        address _token,
        uint _amount,
        uint _destinationChainId,
        address _recipient
    ) external {
        SafeERC20.safeTransferFrom(IERC20(_token), msg.sender, address(this), _amount);
        bridged += _amount;
        destinationChainId = _destinationChainId;
        recipient = _recipient;
    }
}
