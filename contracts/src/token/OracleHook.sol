// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {BaseHook} from "@openzeppelin/uniswap-hooks/base/BaseHook.sol";
import {BaseOracleHook} from "@openzeppelin/uniswap-hooks/oracles/panoptic/BaseOracleHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {Error} from "../utils/Error.sol";
import {Access} from "../utils/auth/Access.sol";

contract OracleHook is BaseOracleHook, Access {
    constructor(
        address _authority,
        IPoolManager _poolManager,
        int24 _maxAbsTickDelta
    ) BaseHook(_poolManager) BaseOracleHook(_maxAbsTickDelta) Access(_authority) {
        if (_maxAbsTickDelta <= 0) revert Error.Hook__InvalidConfig();
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: true,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function _beforeInitialize(
        address _sender,
        PoolKey calldata,
        uint160
    ) internal view override returns (bytes4) {
        if (!authMap[_sender]) revert Error.Hook__Forbidden(_sender);
        return this.beforeInitialize.selector;
    }
}
