// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

library MandateLib {
    struct Mandate {
        address master;
        uint skin;
        uint allocationRate;
        uint exitCap;
        uint cooldownPeriod;
        uint expiry;
    }
}
