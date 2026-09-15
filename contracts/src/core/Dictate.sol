// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

import {Error} from "../utils/Error.sol";
import {Access} from "../utils/auth/Access.sol";
import {RouterProxy} from "../utils/RouterProxy.sol";

contract Dictate {
    event AccessSet(address indexed target, address indexed user, bool enabled);

    address public immutable owner;

    mapping(bytes32 name => address proxy) public gateMap;

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    function _onlyOwner() internal view {
        if (msg.sender != owner) revert Error.Dictate__Unauthorized();
    }

    constructor(
        address _owner
    ) {
        if (_owner == address(0)) revert Error.Dictate__InvalidOwner();
        owner = _owner;
    }

    function setGate(
        bytes32 _name,
        address _impl
    ) external onlyOwner returns (address proxy_) {
        proxy_ = gateMap[_name];
        if (proxy_ == address(0)) {
            proxy_ = Create2.computeAddress(
                _name, keccak256(abi.encodePacked(type(RouterProxy).creationCode, abi.encode(address(this))))
            );
            if (proxy_.code.length == 0) proxy_ = address(new RouterProxy{salt: _name}(address(this)));
            gateMap[_name] = proxy_;
        }
        RouterProxy(payable(proxy_)).upgrade(_impl, "");
    }

    function setAccess(
        Access _target,
        address _user
    ) external onlyOwner {
        _target.setAccess(_user, true);
        emit AccessSet(address(_target), _user, true);
    }

    function removeAccess(
        Access _target,
        address _user
    ) external onlyOwner {
        _target.setAccess(_user, false);
        emit AccessSet(address(_target), _user, false);
    }
}
