// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Wrapped native token (WETH-style) surface used by TransferUtils
/// for native↔ERC20 fallbacks.
interface IWNT is IERC20 {
    function deposit() external payable;
    function withdraw(
        uint amount
    ) external;
}
