// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {LibClone} from "solady/utils/LibClone.sol";

import {MasterAccount} from "../core/MasterAccount.sol";
import {ShareToken} from "./ShareToken.sol";
import {Error} from "../utils/Error.sol";
import {Access} from "../utils/auth/Access.sol";
import {IAuthority} from "../utils/interfaces/IAuthority.sol";

contract ShareModule is Access {
    address public immutable shareTokenImpl;

    constructor(
        IAuthority _authority,
        address _shareTokenImpl
    ) Access(_authority) {
        if (_shareTokenImpl == address(0)) revert Error.Share__InvalidImpl();
        shareTokenImpl = _shareTokenImpl;
    }

    function predict(
        address _master
    ) external view returns (address) {
        return LibClone.predictDeterministicAddress(
            shareTokenImpl, _cloneArgs(_master), bytes32(uint(uint160(_master))), address(this)
        );
    }

    function createShareToken(
        address _master,
        uint _initialSupply
    ) external auth returns (address shareToken_) {
        shareToken_ = LibClone.cloneDeterministic(shareTokenImpl, _cloneArgs(_master), bytes32(uint(uint160(_master))));
        _logEvent("CreateShareToken", abi.encode(_master, shareToken_, _initialSupply));
    }

    function mint(
        ShareToken _shareToken,
        address _to,
        uint _amount
    ) external auth {
        _shareToken.mint(_to, _amount);
    }

    function mintMany(
        ShareToken _shareToken,
        address[] calldata _toList,
        uint[] calldata _amountList
    ) external auth {
        _shareToken.mintMany(_toList, _amountList);
    }

    function burn(
        ShareToken _shareToken,
        address _from,
        uint _amount
    ) external auth {
        _shareToken.burn(_from, _amount);
    }

    function transferFrom(
        ShareToken _shareToken,
        address _from,
        address _to,
        uint _amount
    ) external auth {
        _shareToken.transferFrom(_from, _to, _amount);
    }

    function _cloneArgs(
        address _master
    ) internal view returns (bytes memory) {
        bytes32 _name = MasterAccount(payable(_master)).getName();
        return abi.encodePacked(_master, address(this), _name, bytes4(_name));
    }
}
