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

    modifier onlyShareGate() {
        _onlyShareGate();
        _;
    }

    function _onlyShareGate() internal view {
        if (address(this) == _self || msg.sender != shareGate()) revert Error.ShareToken__NotShareGate();
    }

    function master() public view returns (address _m) {
        bytes memory _b = LibClone.argsOnClone(address(this), 0, 20);
        assembly ("memory-safe") {
            _m := shr(96, mload(add(_b, 0x20)))
        }
    }

    function shareGate() public view returns (address _g) {
        bytes memory _b = LibClone.argsOnClone(address(this), 20, 40);
        assembly ("memory-safe") {
            _g := shr(96, mload(add(_b, 0x20)))
        }
    }

    function name() public view override returns (string memory) {
        return string(LibClone.argsOnClone(address(this), 40, 72));
    }

    function symbol() public view override returns (string memory) {
        return string(LibClone.argsOnClone(address(this), 72, 76));
    }

    function mint(
        address _to,
        uint _amount
    ) external onlyShareGate {
        _mint(_to, _amount);
    }

    function mintMany(
        address[] calldata _toList,
        uint[] calldata _amountList
    ) external onlyShareGate {
        for (uint _i; _i < _toList.length; ++_i) {
            uint _amount = _amountList[_i];
            if (_amount == 0) continue;
            _mint(_toList[_i], _amount);
        }
    }

    function burn(
        address _from,
        uint _amount
    ) external onlyShareGate {
        _burn(_from, _amount);
    }

    function transferFrom(
        address _from,
        address _to,
        uint _amount
    ) public override onlyShareGate returns (bool) {
        _transfer(_from, _to, _amount);
        return true;
    }
}
