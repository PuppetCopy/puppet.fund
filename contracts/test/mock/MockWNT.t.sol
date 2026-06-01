// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockWNT is ERC20 {
    constructor() ERC20("Wrapped Native Token", "WNT") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(
        uint amount
    ) external {
        _burn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "withdraw fail");
    }

    receive() external payable {
        _mint(msg.sender, msg.value);
    }
}
