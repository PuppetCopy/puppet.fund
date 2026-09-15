// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

interface IAccount is IERC1271 {
    struct Call {
        address target;
        uint value;
        uint gasLimit;
        bytes callData;
    }

    function args() external view returns (address module, address user, address signer);

    function nonce() external view returns (uint);

    function genesis(
        address user,
        address signer,
        bytes calldata keySignature
    ) external returns (bytes32 digest);

    function execute(
        address attestor,
        bytes32 digest,
        bytes calldata signature,
        Call[] calldata callList
    ) external payable returns (bytes[] memory resultList);
}
