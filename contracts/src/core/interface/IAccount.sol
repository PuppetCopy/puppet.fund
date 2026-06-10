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

    struct SignTransfer {
        bytes32 tokenId;
        IERC20 token;
        uint amountIn;
        uint amountOut;
    }

    function getAttest() external view returns (address);
    function signedBalanceOf(
        bytes32 tokenId
    ) external view returns (uint);
    function execute(
        Call[] calldata callList,
        SignTransfer[] calldata transferList
    )
        external
        payable
        returns (uint[] memory signedPostBalanceList, uint[] memory postBalanceList, bytes[] memory returnDataList);
}
