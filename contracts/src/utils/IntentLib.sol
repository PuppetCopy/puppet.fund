// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Error} from "./Error.sol";
import {Register} from "../core/Register.sol";

uint constant RATE_PRECISION = 10_000;

library IntentLib {
    function verifyRegistered(
        Register _register,
        address _token
    ) internal view {
        if (_register.tokenIdMap(_token) == bytes32(0)) revert Error.Intent__TokenNotValuable(_token);
    }

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
