// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {AccountLib} from "./AccountLib.sol";

bytes32 constant MANDATE_TYPEHASH = keccak256(
    "Mandate(address master,uint256 skin,uint256 allocationRate,uint256 exitCap,uint256 cooldownPeriod,uint256 expiry)"
);

uint constant MANDATE_BYTES = 6 * 32;

library MandateLib {
    struct Mandate {
        address master;
        uint skin;
        uint allocationRate;
        uint exitCap;
        uint cooldownPeriod;
        uint expiry;
    }

    function digest(
        address _puppet,
        Mandate memory _m
    ) internal view returns (bytes32) {
        return AccountLib.typedDigest(
            block.chainid,
            _puppet,
            keccak256(
                abi.encode(
                    MANDATE_TYPEHASH, _m.master, _m.skin, _m.allocationRate, _m.exitCap, _m.cooldownPeriod, _m.expiry
                )
            )
        );
    }
}
