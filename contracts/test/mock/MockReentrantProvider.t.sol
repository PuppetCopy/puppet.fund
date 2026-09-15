// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

contract MockReentrantProvider {
    address public gate;
    bytes public reentrantCall;

    function arm(
        address _gate,
        bytes calldata _call
    ) external {
        gate = _gate;
        reentrantCall = _call;
    }

    function swap(
        address,
        uint,
        address,
        uint,
        address
    ) external {
        (bool _ok, bytes memory _ret) = gate.call(reentrantCall);
        if (!_ok) {
            assembly {
                revert(add(_ret, 32), mload(_ret))
            }
        }
    }
}
