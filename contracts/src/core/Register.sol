// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {Access} from "../utils/auth/Access.sol";
import {Error} from "../utils/Error.sol";
import {IAuthority} from "../utils/interfaces/IAuthority.sol";
import {IWNT} from "../utils/interfaces/IWNT.sol";

contract Register is Access {
    mapping(address token => uint cap) public tokenCapMap;
    mapping(address provider => uint cap) public providerCapMap;
    address public wntToken;

    constructor(
        IAuthority _authority
    ) Access(_authority) {}

    function getWnt() external view returns (IWNT) {
        address _wnt = wntToken;
        if (_wnt == address(0)) revert Error.Register__WntNotSet();
        return IWNT(_wnt);
    }

    function registerToken(
        address _token,
        uint _cap
    ) external auth {
        if (_token == address(0)) revert Error.Register__InvalidToken();
        tokenCapMap[_token] = _cap;
        _logEvent("RegisterToken", abi.encode(block.chainid, _token, _cap));
    }

    function setProvider(
        address _provider,
        uint _cap
    ) external auth {
        if (_provider == address(0)) revert Error.Register__InvalidProvider();
        providerCapMap[_provider] = _cap;
        _logEvent("SetProvider", abi.encode(block.chainid, _provider, _cap));
    }

    function setWnt(
        address _token
    ) external auth {
        if (tokenCapMap[_token] == 0) revert Error.Register__UnknownToken(_token);
        wntToken = _token;
        _logEvent("SetWnt", abi.encode(block.chainid, _token));
    }
}
