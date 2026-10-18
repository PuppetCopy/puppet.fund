// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Error} from "./Error.sol";

uint constant RATE_PRECISION = 10_000;

library IntentLib {
    function verifyRelayFeeRatio(
        uint _relayFee,
        uint _extractable,
        uint _maxRelayFeeBps
    ) internal pure {
        if (_relayFee * RATE_PRECISION > _extractable * _maxRelayFeeBps) {
            revert Error.Intent__RelayFeeRatioExceeded(_relayFee, _extractable, _maxRelayFeeBps);
        }
    }
}
