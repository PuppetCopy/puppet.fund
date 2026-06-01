// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Fixed-point math helpers. Basis-point divisor and 1e30
/// `FLOAT_PRECISION` factor (matches GMX) for NAV / cursor accounting.
library Precision {
    uint public constant BASIS_POINT_DIVISOR = 10_000;
    uint public constant FLOAT_PRECISION = 1e30;
    uint public constant VIRTUAL_SHARES = 1e12;

    function applyBasisPoints(
        uint _bps,
        uint _value
    ) internal pure returns (uint) {
        return Math.mulDiv(_value, _bps, BASIS_POINT_DIVISOR);
    }

    function toBasisPoints(
        uint _value,
        uint _divisor
    ) internal pure returns (uint) {
        return Math.mulDiv(_value, BASIS_POINT_DIVISOR, _divisor);
    }

    function applyFactor(
        uint _factor,
        uint _value
    ) internal pure returns (uint) {
        return Math.mulDiv(_value, _factor, FLOAT_PRECISION);
    }

    function toFactor(
        uint _value,
        uint _divisor
    ) internal pure returns (uint) {
        return Math.mulDiv(_value, FLOAT_PRECISION, _divisor);
    }
}
