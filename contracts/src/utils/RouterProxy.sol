// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {Proxy} from "@openzeppelin/contracts/proxy/Proxy.sol";

import {Error} from "./Error.sol";

contract RouterProxy is Proxy {
    address private immutable authority;

    constructor(
        address _authority
    ) payable {
        authority = _authority;
    }

    function upgrade(
        address _impl
    ) external {
        if (msg.sender != authority) revert Error.Access__CallerNotAuthority();
        ERC1967Utils.upgradeToAndCall(_impl, "");
    }

    function _implementation() internal view override returns (address) {
        return ERC1967Utils.getImplementation();
    }

    receive() external payable {
        revert Error.Balance__ValueMismatch(msg.value, 0);
    }
}
