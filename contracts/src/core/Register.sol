// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Access} from "../utils/auth/Access.sol";
import {Error} from "../utils/Error.sol";
import {NATIVE_TOKEN} from "../utils/Native.sol";

contract Register is Access {
    event Registered(address indexed token, bytes32 tokenId);

    mapping(address token => bytes32 id) public tokenIdMap;

    constructor(
        address _authority
    ) Access(_authority) {}

    function setRegistered(
        address _token,
        bytes32 _tokenId
    ) external auth {
        if (_token != NATIVE_TOKEN && _token.code.length == 0) revert Error.Register__InvalidToken();
        tokenIdMap[_token] = _tokenId;
        emit Registered(_token, _tokenId);
    }
}
