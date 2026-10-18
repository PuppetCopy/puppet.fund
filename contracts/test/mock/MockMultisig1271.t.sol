// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {ECDSA} from "solady/utils/ECDSA.sol";

contract MockMultisig1271 {
    address public immutable first;
    address public immutable second;

    constructor(
        address _first,
        address _second
    ) {
        first = _first;
        second = _second;
    }

    function isValidSignature(
        bytes32 _digest,
        bytes calldata _signature
    ) external view returns (bytes4) {
        if (_signature.length != 130) return 0xffffffff;
        return ECDSA.tryRecoverCalldata(_digest, _signature[:65]) == first
            && ECDSA.tryRecoverCalldata(_digest, _signature[65:]) == second ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}
