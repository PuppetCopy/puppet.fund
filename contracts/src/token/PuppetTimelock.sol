// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

contract PuppetTimelock is TimelockController {
    constructor(
        uint _minDelay,
        address[] memory _members
    ) TimelockController(_minDelay, _members, _members, address(0)) {}
}
