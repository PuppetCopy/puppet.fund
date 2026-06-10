// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {LibClone} from "solady/utils/LibClone.sol";

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
        address _fund,
        bytes32 _baseTokenId,
        bytes32 _name
    ) public view returns (address) {
        return LibClone.predictDeterministicAddress(
            shareTokenImpl, _cloneArgs(_fund, _baseTokenId, _name), bytes32(uint(uint160(_fund))), address(this)
        );
    }

    function verifyShareToken(
        address _fund,
        bytes32 _baseTokenId,
        bytes32 _name
    ) external view returns (address shareToken_) {
        shareToken_ = predict(_fund, _baseTokenId, _name);
        if (shareToken_.code.length == 0) revert Error.Share__NotCreated();
    }

    function createShareToken(
        address _fund,
        bytes32 _baseTokenId,
        uint _initialSupply,
        bytes32 _name
    ) external auth {
        address _shareToken = LibClone.cloneDeterministic(
            shareTokenImpl, _cloneArgs(_fund, _baseTokenId, _name), bytes32(uint(uint160(_fund)))
        );
        _logEvent("CreateShareToken", abi.encode(_fund, _shareToken, _baseTokenId, _initialSupply, _name));
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
        address _fund,
        bytes32 _baseTokenId,
        bytes32 _name
    ) internal view returns (bytes memory) {
        return abi.encodePacked(_fund, address(this), _baseTokenId, _name);
    }
}
