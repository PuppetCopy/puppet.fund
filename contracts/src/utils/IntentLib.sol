// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {Error} from "./Error.sol";
import {Register} from "../core/Register.sol";
import {AccountLib} from "./AccountLib.sol";
import {IAccount} from "./interfaces/IAccount.sol";

uint constant RATE_PRECISION = 10_000;

library IntentLib {
    function verifyIntent(
        AccountLib.IntentHeader calldata _header,
        uint _maxIntentTtl
    ) internal view {
        uint _expected = IAccount(_header.account).nonce();
        if (_header.nonce != _expected) {
            revert Error.Account__NonceMismatch(_header.account, _expected, _header.nonce);
        }
        if (block.timestamp > _header.deadline) {
            revert Error.Intent__ExpiredDeadline(_header.deadline, block.timestamp);
        }
        if (_header.deadline > block.timestamp + _maxIntentTtl) {
            revert Error.Intent__DeadlineTooFar(_header.deadline, block.timestamp, _maxIntentTtl);
        }
        if (_header.fee == 0) revert Error.Intent__ZeroRelayFee(_header.account);
    }

    function verifyRegisteredTokenAndCap(
        Register _register,
        address _token,
        uint _amount
    ) internal view {
        uint _cap = _register.capMap(_token);
        if (_cap == 0) {
            revert Error.Intent__TokenNotValuable(_token);
        }
        if (_amount > _cap) {
            revert Error.Intent__AmountExceedsCap(_amount, _cap);
        }
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
