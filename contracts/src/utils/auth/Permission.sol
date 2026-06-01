// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {Error} from "./../../utils/Error.sol";
import {IAuthority} from "./../interfaces/IAuthority.sol";
import {Module} from "./Module.sol";

abstract contract Permission is Module {
    mapping(bytes4 selector => mapping(address user => bool)) internal permissionMap;

    constructor(
        IAuthority _authority
    ) Module(_authority) {}

    function setPermission(
        bytes4 _selector,
        address _user,
        bool _enabled
    ) external virtual onlyAuthority {
        permissionMap[_selector][_user] = _enabled;
    }

    function canCall(
        bytes4 _selector,
        address _user
    ) public view virtual returns (bool) {
        return permissionMap[_selector][_user];
    }

    function _checkCanCall() internal view override {
        if (!permissionMap[msg.sig][msg.sender]) revert Error.Permission__Unauthorized();
    }
}
