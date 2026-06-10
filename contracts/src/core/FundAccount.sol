// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

import {AccountBase} from "./AccountBase.sol";

contract FundAccount is AccountBase {
    function isValidSignature(
        bytes32 _digest,
        bytes calldata _signature
    ) public view returns (bytes4) {
        return IERC1271(getSigner()).isValidSignature(_digest, _signature);
    }
}
