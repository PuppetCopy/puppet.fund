// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Error} from "../utils/Error.sol";

contract Release {
    address public immutable governor;
    bytes32 public current;

    constructor(
        address _governor
    ) {
        governor = _governor;
    }

    function approve(
        bytes32 _release
    ) external {
        if (msg.sender != governor) revert Error.Access__CallerNotAuthority();
        current = _release;
    }
}
