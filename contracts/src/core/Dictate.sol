// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {Error} from "../utils/Error.sol";
import {Access} from "../utils/auth/Access.sol";
import {Permission} from "../utils/auth/Permission.sol";
import {RouterProxy} from "../utils/ProxyRouter.sol";
import {IAuthority} from "../utils/interfaces/IAuthority.sol";

contract Dictate is IAuthority {
    address public immutable owner;

    mapping(bytes32 name => address proxy) public gateMap;
    mapping(address user => bool) public loggable;

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
            proxy_ = address(new RouterProxy{salt: _name}(this));
            gateMap[_name] = proxy_;
            loggable[proxy_] = true;
        }
        RouterProxy(payable(proxy_)).upgrade(_impl, "");
        bytes memory _config = _gateConfig(proxy_);
        _logEvent("SetGate", abi.encode(block.chainid, _name, proxy_, _impl, _config));
    }

    function _gateConfig(
        address _proxy
    ) internal view returns (bytes memory) {
        (bool _ok, bytes memory _config) = _proxy.staticcall(abi.encodeWithSignature("getConfig()"));
        return _ok ? _config : bytes("");
    }

    function removeGate(
        bytes32 _name
    ) external onlyOwner {
        address _proxy = gateMap[_name];
        if (_proxy == address(0)) revert Error.Dictate__ContractNotRegistered();
        delete gateMap[_name];
        loggable[_proxy] = false;
        _logEvent("RemoveGate", abi.encode(block.chainid, _name, _proxy));
    }

    function setAccess(
        Access _target,
        address _user
    ) external onlyOwner {
        _target.setAccess(_user, true);
        loggable[address(_target)] = true;
        loggable[_user] = true;
        _logEvent("UpdateAccess", abi.encode(block.chainid, address(_target), _user, true));
    }

    function removeAccess(
        Access _target,
        address _user
    ) external onlyOwner {
        _target.setAccess(_user, false);
        _logEvent("UpdateAccess", abi.encode(block.chainid, address(_target), _user, false));
    }

    function setPermission(
        Permission _target,
        bytes4 _selector,
        address _user
    ) external onlyOwner {
        _target.setPermission(_selector, _user, true);
        loggable[address(_target)] = true;
        loggable[_user] = true;
        _logEvent("UpdatePermission", abi.encode(block.chainid, address(_target), _selector, _user, true));
    }

    function removePermission(
        Permission _target,
        bytes4 _selector,
        address _user
    ) external onlyOwner {
        _target.setPermission(_selector, _user, false);
        _logEvent("UpdatePermission", abi.encode(block.chainid, address(_target), _selector, _user, false));
    }

    function logEvent(
        string calldata _method,
        bytes calldata _data
    ) external {
        if (!loggable[msg.sender]) revert Error.Dictate__ContractNotRegistered();
        emit PuppetEventLog(msg.sender, _method, _data);
    }

    function _logEvent(
        string memory _method,
        bytes memory _data
    ) internal {
        emit PuppetEventLog(address(this), _method, _data);
    }
}
