// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

interface ICrossDomainMessenger {
    function xDomainMessageSender() external view returns (address);
}
