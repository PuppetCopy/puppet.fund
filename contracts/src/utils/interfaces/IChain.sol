// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

interface IChain {
    function blockNumber() external view returns (uint);
}
