// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";

import {Access} from "../utils/auth/Access.sol";
import {Error} from "../utils/Error.sol";

contract Chain is Access {
    constructor(
        address _authority
    ) Access(_authority) {}

    function implementation() external view returns (address) {
        return ERC1967Utils.getImplementation();
    }

    function setImplementation(
        address _impl
    ) external auth {
        if (ERC1967Utils.getImplementation() != address(0)) revert Error.Chain__Locked();
        ERC1967Utils.upgradeToAndCall(_impl, "");
    }

    fallback() external {
        address _impl = ERC1967Utils.getImplementation();
        if (_impl == address(0)) revert Error.Chain__NotSet();
        assembly {
            calldatacopy(0, 0, calldatasize())
            let _ok := delegatecall(gas(), _impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch _ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}
