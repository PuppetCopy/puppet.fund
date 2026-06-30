// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {ERC20} from "solady/tokens/ERC20.sol";
import {LibClone} from "solady/utils/LibClone.sol";

import {Error} from "../utils/Error.sol";

contract ShareToken is ERC20 {
    address private immutable _self;

    constructor(
        uint _hubChainId
    ) {
        if (block.chainid != _hubChainId) {
            revert Error.ShareToken__NotHubChain(_hubChainId, block.chainid);
        }
        _self = address(this);
    }

    modifier onlyIssuer() {
        _onlyIssuer();
        _;
    }

    function _onlyIssuer() internal view {
        if (address(this) == _self || msg.sender != getIssueContract()) revert Error.ShareToken__NotIssuer();
    }

    function getFund() public view returns (address _fund) {
        bytes memory _b = LibClone.argsOnClone(address(this), 0, 20);
        assembly ("memory-safe") {
            _fund := shr(96, mload(add(_b, 0x20)))
        }
    }

    function getIssueContract() public view returns (address _g) {
        bytes memory _b = LibClone.argsOnClone(address(this), 20, 40);
        assembly ("memory-safe") {
            _g := shr(96, mload(add(_b, 0x20)))
        }
    }

    function getBaseToken() public view returns (address _token) {
        bytes memory _b = LibClone.argsOnClone(address(this), 40, 60);
        assembly ("memory-safe") {
            _token := shr(96, mload(add(_b, 0x20)))
        }
    }

    function getName() public view returns (bytes32 _name) {
        bytes memory _b = LibClone.argsOnClone(address(this), 60, 92);
        assembly ("memory-safe") {
            _name := mload(add(_b, 0x20))
        }
    }

    function name() public view override returns (string memory) {
        return string(abi.encodePacked(getName()));
    }

    function symbol() public view override returns (string memory) {
        return string(abi.encodePacked(bytes4(getName())));
    }

    function mint(
        address _to,
        uint _amount
    ) external onlyIssuer returns (uint) {
        _mint(_to, _amount);
        return balanceOf(_to);
    }

    function mintMany(
        address[] calldata _toList,
        uint[] calldata _amountList
    ) external onlyIssuer returns (uint[] memory _postList) {
        _postList = new uint[](_toList.length);
        for (uint _i; _i < _toList.length; ++_i) {
            if (_amountList[_i] > 0) _mint(_toList[_i], _amountList[_i]);
            _postList[_i] = balanceOf(_toList[_i]);
        }
    }

    function burn(
        address _from,
        uint _amount
    ) external onlyIssuer {
        _burn(_from, _amount);
    }

    function transfer(
        address _to,
        uint _amount
    ) public override onlyIssuer returns (bool) {
        _transfer(msg.sender, _to, _amount);
        return true;
    }

    function transferFrom(
        address _from,
        address _to,
        uint _amount
    ) public override onlyIssuer returns (bool) {
        _transfer(_from, _to, _amount);
        return true;
    }
}
