// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {Error} from "./../../utils/Error.sol";
import {IAuthority} from "./../interfaces/IAuthority.sol";
import {Module} from "./Module.sol";

abstract contract Access is Module {
    mapping(address user => bool) internal authMap;

    constructor(
        IAuthority _authority
    ) Module(_authority) {}

    function setAccess(
        address _user,
        bool _enabled
    ) external virtual onlyAuthority {
        authMap[_user] = _enabled;
    }

    function canCall(
        address _user
    ) public view virtual returns (bool) {
        return authMap[_user];
    }

    function _checkCanCall() internal view override {
        if (!authMap[msg.sender]) revert Error.Access__Unauthorized();
    }
}
