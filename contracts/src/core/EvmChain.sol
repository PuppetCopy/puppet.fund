// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IChain} from "../utils/interfaces/IChain.sol";

contract EvmChain is IChain {
    function blockNumber() external view returns (uint) {
        return block.number;
    }
}
