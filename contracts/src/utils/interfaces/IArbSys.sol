// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

/// @notice Arbitrum precompile (`address(100)`) — exposes the L2 block
/// number, since Solidity's `block.number` returns the L1 reference on
/// Arbitrum.
interface IArbSys {
    function arbBlockNumber() external view returns (uint);
    function arbBlockHash(
        uint blockNumber
    ) external view returns (bytes32);
}
