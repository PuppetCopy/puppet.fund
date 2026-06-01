// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {TransientSlot} from "@openzeppelin/contracts/utils/TransientSlot.sol";

import {Error} from "./../../utils/Error.sol";
import {IAuthority} from "./../interfaces/IAuthority.sol";

abstract contract Module {
    bytes32 private constant REENTRANCY_GUARD_SLOT = 0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00;

    IAuthority public immutable authority;

    constructor(
        IAuthority _authority
    ) {
        if (address(_authority) == address(0)) revert Error.Module__InvalidAuthority();
        authority = _authority;
    }

    modifier auth() {
        _authEnter();
        _;
        TransientSlot.tstore(TransientSlot.asBoolean(REENTRANCY_GUARD_SLOT), false);
    }

    modifier onlyAuthority() {
        _onlyAuthority();
        _;
    }

    function supportsInterface(
        bytes4 _interfaceId
    ) public view virtual returns (bool) {
        return _interfaceId == type(Module).interfaceId;
    }

    function _authEnter() internal {
        if (TransientSlot.tload(TransientSlot.asBoolean(REENTRANCY_GUARD_SLOT))) {
            revert Error.Module__Reentrant();
        }
        TransientSlot.tstore(TransientSlot.asBoolean(REENTRANCY_GUARD_SLOT), true);
        _checkCanCall();
    }

    function _onlyAuthority() internal view {
        if (msg.sender != address(authority)) revert Error.Module__CallerNotAuthority();
    }

    function _logEvent(
        string memory _method,
        bytes memory _data
    ) internal {
        authority.logEvent(_method, _data);
    }

    function _checkCanCall() internal view virtual;
}
