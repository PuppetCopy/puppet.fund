// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

interface IAccount is IERC1271 {
    struct Call {
        address target;
        uint value;
        uint gasLimit;
        bytes callData;
    }
    function getUser() external view returns (address);
    function getSigner() external view returns (address);
    function getAttest() external view returns (address);
    function signedBalance() external view returns (uint);
    function execute(
        Call[] calldata callList,
        IERC20 baseToken,
        uint amountIn,
        uint amountOut,
        uint relayFee,
        address feeReceiver,
        uint transferGasLimit
    ) external payable returns (uint signedPostBalance, uint postBalance, bytes[] memory returnData);
}
