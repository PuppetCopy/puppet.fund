// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

interface IAuthority {
    event PuppetEventLog(address indexed source, string indexed method, bytes data);

    function logEvent(
        string calldata method,
        bytes calldata data
    ) external;
}
