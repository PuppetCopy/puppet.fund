// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Access} from "../../utils/auth/Access.sol";
import {Error} from "../../utils/Error.sol";
import {IAuthority} from "../../utils/interfaces/IAuthority.sol";
import {IWNT} from "../../utils/interfaces/IWNT.sol";

contract RegisterModule is Access {
    struct TokenInfo {
        IERC20 token;
        uint cap;
        address hubToken;
    }

    uint public immutable hubChainId;

    mapping(bytes32 tokenId => TokenInfo info) public tokenRegistryMap;
    bytes32 public wntBaseTokenId;

    constructor(
        IAuthority _authority,
        uint _hubChainId
    ) Access(_authority) {
        hubChainId = _hubChainId;
    }

    function getTokenInfo(
        bytes32 _tokenId
    ) external view returns (TokenInfo memory) {
        return tokenRegistryMap[_tokenId];
    }

    function getWnt() external view returns (IWNT) {
        bytes32 _id = wntBaseTokenId;
        if (_id == bytes32(0)) revert Error.Register__WntNotSet();
        return IWNT(address(tokenRegistryMap[_id].token));
    }

    function registerToken(
        bytes32 _tokenId,
        IERC20 _token,
        uint _cap,
        address _hubToken
    ) external auth {
        if (_tokenId == bytes32(0)) revert Error.Account__InvalidBaseTokenId();
        if (_hubToken == address(0)) revert Error.Register__InvalidHubToken();
        if (_hubToken == address(_token) && block.chainid != hubChainId) {
            revert Error.Register__SelfHubTokenOnSpoke(block.chainid, address(_token));
        }
        IERC20 _registered = tokenRegistryMap[_tokenId].token;
        if (address(_registered) != address(0) && _registered != _token) {
            revert Error.Register__TokenSwapForbidden(_tokenId, address(_registered), address(_token));
        }
        tokenRegistryMap[_tokenId] = TokenInfo({token: _token, cap: _cap, hubToken: _hubToken});
        _logEvent("RegisterToken", abi.encode(block.chainid, _tokenId, _token, _cap, _hubToken));
    }

    function setWnt(
        bytes32 _tokenId
    ) external auth {
        IERC20 _wnt = tokenRegistryMap[_tokenId].token;
        if (address(_wnt) == address(0)) revert Error.Register__UnknownBaseTokenId(_tokenId);
        wntBaseTokenId = _tokenId;
        _logEvent("SetWnt", abi.encode(block.chainid, _tokenId, _wnt));
    }
}
