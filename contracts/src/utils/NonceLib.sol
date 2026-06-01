// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

/// @notice Bitpacked single-use nonce store, 256 nonces per storage slot,
/// keyed per-account (`scope, account, nonce`).
library NonceLib {
    function consumeBy(
        uint _scope,
        uint _nonce,
        address _account
    ) internal {
        assembly ("memory-safe") {
            let _freeMemoryPointer := mload(0x40)

            // Bucket slot = keccak256(scope ++ account ++ nonce[0:31])
            mstore(0x20, _account)
            mstore(0x0c, _scope)
            mstore(0x40, _nonce)
            let _bucketSlot := keccak256(0x28, 0x37)

            let _bucketValue := sload(_bucketSlot)
            let _bit := shl(and(0xff, _nonce), 1)
            if and(_bit, _bucketValue) {
                // Error.NonceLib__InvalidNonceForAccount(address,uint256) - selector: 0x1be3eedf
                mstore(0x00, 0x1be3eedf)
                mstore(0x20, _account)
                mstore(0x40, _nonce)
                revert(0x1c, 0x44)
            }

            sstore(_bucketSlot, or(_bucketValue, _bit))
            mstore(0x40, _freeMemoryPointer)
        }
    }

    function isConsumedBy(
        uint _scope,
        uint _nonce,
        address _account
    ) internal view returns (bool _consumed) {
        assembly ("memory-safe") {
            let _freeMemoryPointer := mload(0x40)

            mstore(0x20, _account)
            mstore(0x0c, _scope)
            mstore(0x40, _nonce)

            _consumed := gt(and(shl(and(0xff, _nonce), 1), sload(keccak256(0x28, 0x37))), 0)

            mstore(0x40, _freeMemoryPointer)
        }
    }
}
