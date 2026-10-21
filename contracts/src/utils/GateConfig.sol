// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

struct GateConfig {
    address attestor;
    address feeReceiver;
    uint transferGasLimit;
    uint maxIntentTtl;
    uint maxRelayFeeBps;
    uint maxSwapRelayFeeBps;
}
