// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {Proxy} from "@openzeppelin/contracts/proxy/Proxy.sol";

import {Error} from "./Error.sol";
import {IAuthority} from "./interfaces/IAuthority.sol";

contract RouterProxy is Proxy {
    IAuthority private immutable authority;

    constructor(
        IAuthority _authority
    ) payable {
        authority = _authority;
    }

    function upgrade(
        address _impl,
        bytes memory _data
    ) external {
        if (msg.sender != address(authority)) revert Error.Module__CallerNotAuthority();
        ERC1967Utils.upgradeToAndCall(_impl, _data);
    }

    function _implementation() internal view override returns (address) {
        return ERC1967Utils.getImplementation();
    }

    receive() external payable {}
}
