// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {BaseGate} from "./BaseGate.sol";
import {Error} from "./Error.sol";
import {IAuthority} from "./interfaces/IAuthority.sol";
import {AccountModule} from "../core/module/AccountModule.sol";
import {BridgeModule} from "../core/module/BridgeModule.sol";
import {WalletDepositModule} from "../core/module/WalletDepositModule.sol";
import {RegisterModule} from "../core/module/RegisterModule.sol";

abstract contract BaseAccountGate is BaseGate {
    WalletDepositModule internal immutable walletDepositModule;
    uint internal immutable hubChainId;

    constructor(
        IAuthority _authority,
        AccountModule _accountGate,
        BridgeModule _bridge,
        WalletDepositModule _walletDeposit,
        RegisterModule _register,
        uint _hubChainId,
        Config memory _config
    ) BaseGate(_authority, _accountGate, _bridge, _register, _config) {
        if (address(_walletDeposit) == address(0)) revert Error.Gate__InvalidModule();
        walletDepositModule = _walletDeposit;
        hubChainId = _hubChainId;
    }

    function _blockNumber() internal view returns (uint) {
        return address(arbSys).code.length > 0 ? arbSys.arbBlockNumber() : block.number;
    }
}
