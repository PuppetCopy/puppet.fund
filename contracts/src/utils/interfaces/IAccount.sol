// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

interface IAccount is IERC1271 {
    struct Call {
        address target;
        uint value;
        uint gasLimit;
        bytes callData;
    }

    struct SignTransfer {
        address token;
        uint amountIn;
        uint amountOut;
    }

    function getAttestContract() external view returns (address);
    function signedBalanceOf(
        address token
    ) external view returns (uint);
    function execute(
        Call[] calldata callList,
        SignTransfer[] calldata transferList
    )
        external
        payable
        returns (uint[] memory signedPostBalanceList, uint[] memory postBalanceList, bytes[] memory returnDataList);
}
