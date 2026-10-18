// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {Error} from "../utils/Error.sol";

contract Reserve {
    using SafeERC20 for IERC20;

    IERC20 public immutable puppet;
    address public immutable timelock;
    uint public immutable start;
    uint public immutable incentivesPerYear;
    uint public immutable grantsCap;

    uint public incentiveYear;
    uint public incentivesPaid;
    uint public grantsPaid;

    constructor(
        IERC20 _puppet,
        address _timelock,
        uint _start,
        uint _incentivesPerYear,
        uint _grantsCap
    ) {
        if (address(_puppet) == address(0) || _timelock == address(0)) revert Error.Reserve__InvalidConfig();
        puppet = _puppet;
        timelock = _timelock;
        start = _start;
        incentivesPerYear = _incentivesPerYear;
        grantsCap = _grantsCap;
    }

    function payIncentive(
        address _to,
        uint _amount
    ) external {
        if (msg.sender != timelock) revert Error.Reserve__Forbidden(msg.sender);
        if (block.timestamp < start) revert Error.Reserve__NotStarted(start);
        uint _year = (block.timestamp - start) / 365 days;
        uint _paid = (_year == incentiveYear ? incentivesPaid : 0) + _amount;
        if (_paid > incentivesPerYear) revert Error.Reserve__AboveCap(_paid, incentivesPerYear);
        incentiveYear = _year;
        incentivesPaid = _paid;
        puppet.safeTransfer(_to, _amount);
    }

    function grant(
        address _to,
        uint _amount
    ) external {
        if (msg.sender != timelock) revert Error.Reserve__Forbidden(msg.sender);
        uint _paid = grantsPaid + _amount;
        if (_paid > grantsCap) revert Error.Reserve__AboveCap(_paid, grantsCap);
        grantsPaid = _paid;
        puppet.safeTransfer(_to, _amount);
    }
}
