// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Access} from "../utils/auth/Access.sol";

contract MandateStore is Access {
    mapping(address puppet => mapping(address master => bytes32 digest)) public mandateMap;

    constructor(
        address _authority
    ) Access(_authority) {}

    function setMandate(
        address _puppet,
        address _master,
        bytes32 _digest
    ) external auth {
        mandateMap[_puppet][_master] = _digest;
    }
}
