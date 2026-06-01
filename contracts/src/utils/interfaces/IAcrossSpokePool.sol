// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

/// @notice Across v3 SpokePool surface used by Spoke / Deposit (depositV3 only).
interface IAcrossSpokePool {
    function depositV3(
        address depositor,
        address recipient,
        address inputToken,
        address outputToken,
        uint inputAmount,
        uint outputAmount,
        uint destinationChainId,
        address exclusiveRelayer,
        uint32 quoteTimestamp,
        uint32 fillDeadline,
        uint32 exclusivityDeadline,
        bytes calldata message
    ) external payable;
}
