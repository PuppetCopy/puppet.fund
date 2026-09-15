// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IArbSys} from "../utils/interfaces/IArbSys.sol";
import {IChain} from "../utils/interfaces/IChain.sol";

contract ArbitrumChain is IChain {
    IArbSys internal constant arbSys = IArbSys(address(100));

    function blockNumber() external view returns (uint) {
        return arbSys.arbBlockNumber();
    }
}
