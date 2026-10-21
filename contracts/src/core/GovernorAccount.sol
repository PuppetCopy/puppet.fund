// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Error} from "../utils/Error.sol";
import {IAccount} from "../utils/interfaces/IAccount.sol";

contract GovernorAccount {
    address internal constant fxChild = 0x8397259c983751DAf40400790063935a11afa28a;
    bytes32 internal constant FX_CHILD_CODEHASH = 0x5a0ac060940b3bd3c2cdb09553d443a74a3c7897bf345f6cab0c1fbfe07bd67d;
    uint160 internal constant ALIAS_OFFSET = uint160(0x1111000000000000000000000000000000001111);

    address public immutable governor;

    constructor(
        address _governor
    ) {
        governor = _governor;
    }

    receive() external payable {}

    function execute(
        uint _deadline,
        IAccount.Call[] calldata _callList
    ) external payable {
        unchecked {
            if (msg.sender != address(uint160(governor) + ALIAS_OFFSET)) {
                revert Error.GovernorAccount__Forbidden(msg.sender);
            }
        }
        if (block.timestamp > _deadline) revert Error.GovernorAccount__ExpiredDeadline(_deadline, block.timestamp);
        for (uint _i; _i < _callList.length; ++_i) {
            IAccount.Call calldata _call = _callList[_i];
            (bool _ok, bytes memory _result) = _call.target
            .call{value: _call.value, gas: _call.gasLimit > 0 ? _call.gasLimit : gasleft()}(
                _call.callData
            );
            if (!_ok) revert Error.GovernorAccount__CallFailed(_result);
        }
    }

    function processMessageFromRoot(
        uint,
        address _rootMessageSender,
        bytes calldata _message
    ) external {
        if (msg.sender != fxChild || fxChild.codehash != FX_CHILD_CODEHASH || _rootMessageSender != governor) {
            revert Error.GovernorAccount__Forbidden(msg.sender);
        }
        (uint _deadline, IAccount.Call[] memory _callList) = abi.decode(_message, (uint, IAccount.Call[]));
        if (block.timestamp > _deadline) revert Error.GovernorAccount__ExpiredDeadline(_deadline, block.timestamp);
        for (uint _i; _i < _callList.length; ++_i) {
            IAccount.Call memory _call = _callList[_i];
            (bool _ok, bytes memory _result) = _call.target
            .call{value: _call.value, gas: _call.gasLimit > 0 ? _call.gasLimit : gasleft()}(
                _call.callData
            );
            if (!_ok) revert Error.GovernorAccount__CallFailed(_result);
        }
    }
}
