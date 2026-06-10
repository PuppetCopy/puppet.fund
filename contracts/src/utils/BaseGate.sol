// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {Permission} from "./auth/Permission.sol";
import {Error} from "./Error.sol";
import {IAuthority} from "./interfaces/IAuthority.sol";
import {IArbSys} from "./interfaces/IArbSys.sol";
import {AccountModule} from "../core/module/AccountModule.sol";
import {RegisterModule} from "../core/module/RegisterModule.sol";

abstract contract BaseGate is Permission {
    struct Config {
        address attestor;
        address feeReceiver;
        uint transferGasLimit;
        uint maxBlockDelay;
        uint maxRelayFeeBps;
    }

    IArbSys internal constant arbSys = IArbSys(address(100));

    AccountModule internal immutable accountModule;
    RegisterModule internal immutable registerModule;

    address internal immutable attestor;
    address internal immutable feeReceiver;
    uint internal immutable transferGasLimit;
    uint internal immutable maxBlockDelay;
    uint internal immutable maxRelayFeeBps;

    constructor(
        IAuthority _authority,
        AccountModule _accountModule,
        RegisterModule _register,
        Config memory _config
    ) Permission(_authority) {
        if (address(_accountModule) == address(0) || address(_register) == address(0)) {
            revert Error.Gate__InvalidModule();
        }
        accountModule = _accountModule;
        registerModule = _register;
        attestor = _config.attestor;
        feeReceiver = _config.feeReceiver;
        transferGasLimit = _config.transferGasLimit;
        maxBlockDelay = _config.maxBlockDelay;
        maxRelayFeeBps = _config.maxRelayFeeBps;
    }

    function getConfig() external view returns (Config memory) {
        return Config({
            attestor: attestor,
            feeReceiver: feeReceiver,
            transferGasLimit: transferGasLimit,
            maxBlockDelay: maxBlockDelay,
            maxRelayFeeBps: maxRelayFeeBps
        });
    }

    function _blockNumber() internal view returns (uint) {
        return address(arbSys).code.length > 0 ? arbSys.arbBlockNumber() : block.number;
    }
}
