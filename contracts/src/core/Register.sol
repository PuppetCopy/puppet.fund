// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Access} from "../utils/auth/Access.sol";
import {Error} from "../utils/Error.sol";
import {NATIVE_TOKEN} from "../utils/Native.sol";

contract Register is Access {
    event Registered(address indexed token, uint cap, bytes32 tokenId);

    mapping(address token => uint cap) public capMap;
    mapping(address token => bytes32 id) public tokenIdMap;

    constructor(
        address _authority
    ) Access(_authority) {}

    function setRegistered(
        address _token,
        uint _cap,
        bytes32 _tokenId
    ) external auth {
        if (_token != NATIVE_TOKEN && _token.code.length == 0) revert Error.Register__InvalidToken();
        if (_cap != 0 && _tokenId == bytes32(0)) revert Error.Register__InvalidToken();
        capMap[_token] = _cap;
        tokenIdMap[_token] = _cap == 0 ? bytes32(0) : _tokenId;
        emit Registered(_token, _cap, _tokenId);
    }
}
