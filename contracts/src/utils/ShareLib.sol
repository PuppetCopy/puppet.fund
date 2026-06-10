// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

bytes32 constant SHARE_INIT_TYPEHASH = keccak256("ShareInitParams(address master,bytes32 baseTokenId,bytes32 name)");

library ShareLib {
    struct ShareInitParams {
        address master;
        bytes32 baseTokenId;
        bytes32 name;
    }

    function hashShare(
        ShareInitParams calldata _p
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(SHARE_INIT_TYPEHASH, _p.master, _p.baseTokenId, _p.name));
    }
}
