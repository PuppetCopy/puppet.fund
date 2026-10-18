// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

interface IAccount {
    struct Call {
        address target;
        uint value;
        uint gasLimit;
        bytes callData;
    }

    function user() external view returns (address);

    function nonce() external view returns (uint);

    function execute(
        address attestor,
        bytes32 structHash,
        uint deadline,
        bytes calldata coSig,
        Call[] calldata callList
    ) external returns (bytes32 digest, bytes[] memory resultList);
}
