// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {TransientSlot} from "@openzeppelin/contracts/utils/TransientSlot.sol";

import {Error} from "./../../utils/Error.sol";

bytes4 constant FULL_ACCESS = 0xffffffff;

abstract contract Access {
    bytes32 private constant REENTRANCY_GUARD_SLOT = 0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00;

    address public immutable authority;

    mapping(address user => bytes4 selector) public authMap;

    constructor(
        address _authority
    ) {
        if (_authority == address(0)) revert Error.Access__InvalidAuthority();
        authority = _authority;
    }

    modifier auth() {
        _authEnter();
        _;
        _authExit();
    }

    function _authEnter() internal {
        if (TransientSlot.tload(TransientSlot.asBoolean(REENTRANCY_GUARD_SLOT))) revert Error.Access__Reentrant();
        bytes4 _granted = authMap[msg.sender];
        if (_granted == bytes4(0) || (_granted != msg.sig && _granted != FULL_ACCESS)) {
            revert Error.Access__Unauthorized();
        }
        TransientSlot.tstore(TransientSlot.asBoolean(REENTRANCY_GUARD_SLOT), true);
    }

    function _authExit() internal {
        TransientSlot.tstore(TransientSlot.asBoolean(REENTRANCY_GUARD_SLOT), false);
    }

    function setAccess(
        address _user,
        bytes4 _selector
    ) external {
        if (msg.sender != authority) revert Error.Access__CallerNotAuthority();
        authMap[_user] = _selector;
    }
}
