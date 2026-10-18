// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";

import {Error} from "../utils/Error.sol";

contract Vesting is VestingWallet {
    constructor(
        address _beneficiary,
        uint64 _start,
        uint64 _duration
    ) VestingWallet(_beneficiary, _start, _duration) {}

    function delegate(
        IVotes _token,
        address _delegatee
    ) external onlyOwner {
        _token.delegate(_delegatee);
    }

    function transferOwnership(
        address
    ) public pure override {
        revert Error.Vesting__Forbidden();
    }

    function renounceOwnership() public pure override {
        revert Error.Vesting__Forbidden();
    }
}
