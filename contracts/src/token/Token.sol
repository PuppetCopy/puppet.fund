// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import {Error} from "../utils/Error.sol";

contract Token is ERC20, EIP712, ERC20Votes {
    uint public constant SUPPLY = 100_000_000e18;

    constructor(
        address _receiver
    ) ERC20("Puppet", "PUPPET") EIP712("Puppet", "1") {
        if (_receiver == address(0)) revert Error.Token__InvalidReceiver();
        _mint(_receiver, SUPPLY);
    }

    function clock() public view override returns (uint48) {
        return uint48(block.timestamp);
    }

    function CLOCK_MODE() public pure override returns (string memory) {
        return "mode=timestamp";
    }

    function _update(
        address _from,
        address _to,
        uint _value
    ) internal override(ERC20, ERC20Votes) {
        super._update(_from, _to, _value);
    }
}
