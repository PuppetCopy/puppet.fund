// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {ERC20} from "solady/tokens/ERC20.sol";
import {LibClone} from "solady/utils/LibClone.sol";

import {Error} from "../utils/Error.sol";

uint constant HUB_CHAIN_ID = 42_161;

contract ShareToken is ERC20 {
    address private immutable _self;

    constructor() {
        if (block.chainid != HUB_CHAIN_ID) {
            revert Error.ShareToken__NotHubChain(HUB_CHAIN_ID, block.chainid);
        }
        _self = address(this);
    }

    modifier onlyShareModule() {
        _onlyShareModule();
        _;
    }

    function _onlyShareModule() internal view {
        if (address(this) == _self || msg.sender != getShareModule()) revert Error.ShareToken__NotShareGate();
    }

    function getFund() public view returns (address _fund) {
        bytes memory _b = LibClone.argsOnClone(address(this), 0, 20);
        assembly ("memory-safe") {
            _fund := shr(96, mload(add(_b, 0x20)))
        }
    }

    function getShareModule() public view returns (address _g) {
        bytes memory _b = LibClone.argsOnClone(address(this), 20, 40);
        assembly ("memory-safe") {
            _g := shr(96, mload(add(_b, 0x20)))
        }
    }

    function getBaseTokenId() public view returns (bytes32 _id) {
        bytes memory _b = LibClone.argsOnClone(address(this), 40, 72);
        assembly ("memory-safe") {
            _id := mload(add(_b, 0x20))
        }
    }

    function getName() public view returns (bytes32 _name) {
        bytes memory _b = LibClone.argsOnClone(address(this), 72, 104);
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
    ) external onlyShareModule {
        _mint(_to, _amount);
    }

    function mintMany(
        address[] calldata _toList,
        uint[] calldata _amountList
    ) external onlyShareModule {
        for (uint _i; _i < _toList.length; ++_i) {
            uint _amount = _amountList[_i];
            if (_amount == 0) continue;
            _mint(_toList[_i], _amount);
        }
    }

    function burn(
        address _from,
        uint _amount
    ) external onlyShareModule {
        _burn(_from, _amount);
    }

    function transfer(
        address _to,
        uint _amount
    ) public override onlyShareModule returns (bool) {
        _transfer(msg.sender, _to, _amount);
        return true;
    }

    function transferFrom(
        address _from,
        address _to,
        uint _amount
    ) public override onlyShareModule returns (bool) {
        _transfer(_from, _to, _amount);
        return true;
    }
}
