// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {SignedMath} from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import {CurrencySettler} from "@openzeppelin/uniswap-hooks/utils/CurrencySettler.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {Error} from "../utils/Error.sol";
import {Access} from "../utils/auth/Access.sol";
import {OracleHook} from "./OracleHook.sol";

contract LiquidityLock is Access, IUnlockCallback {
    using CurrencySettler for Currency;
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;

    IPoolManager public immutable poolManager;
    OracleHook public immutable hook;
    address public immutable puppet;
    uint24 public immutable fee;
    int24 public immutable tickSpacing;
    address public immutable foundation;
    bool public immutable withdrawable;
    uint32 public immutable twapWindow;
    int24 public immutable maxTickDeviation;

    constructor(
        address _authority,
        IPoolManager _poolManager,
        OracleHook _hook,
        address _puppet,
        uint24 _fee,
        int24 _tickSpacing,
        address _foundation,
        bool _withdrawable,
        uint32 _twapWindow,
        int24 _maxTickDeviation
    ) Access(_authority) {
        if (
            address(_poolManager) == address(0) || address(_hook) == address(0) || _puppet == address(0)
                || _fee > LPFeeLibrary.MAX_LP_FEE || _tickSpacing < TickMath.MIN_TICK_SPACING
                || _tickSpacing > TickMath.MAX_TICK_SPACING || _foundation == address(0) || _twapWindow == 0
                || _maxTickDeviation <= 0
        ) {
            revert Error.LiquidityLock__InvalidConfig();
        }
        poolManager = _poolManager;
        hook = _hook;
        puppet = _puppet;
        fee = _fee;
        tickSpacing = _tickSpacing;
        foundation = _foundation;
        withdrawable = _withdrawable;
        twapWindow = _twapWindow;
        maxTickDeviation = _maxTickDeviation;
    }

    receive() external payable {}

    function open(
        uint160 _sqrtPriceX96,
        uint128 _liquidity
    ) external auth {
        poolManager.initialize(_poolKey(), _sqrtPriceX96);
        poolManager.unlock(abi.encode(int(uint(_liquidity))));
    }

    function addBase(
        uint128 _liquidity
    ) external auth {
        PoolKey memory _key = _poolKey();
        uint32[] memory _secondsAgoList = new uint32[](2);
        _secondsAgoList[0] = twapWindow;
        (, int56[] memory _truncatedList) = hook.observe(_secondsAgoList, _key.toId());
        int56 _tickDelta = _truncatedList[1] - _truncatedList[0];
        int24 _twap = int24(_tickDelta / int56(uint56(twapWindow)));
        if (_tickDelta < 0 && _tickDelta % int56(uint56(twapWindow)) != 0) _twap -= 1;
        (, int24 _spot,,) = poolManager.getSlot0(_key.toId());
        if (SignedMath.abs(int(_spot) - int(_twap)) > uint(int(maxTickDeviation))) {
            revert Error.LiquidityLock__OffMarket(_spot, _twap);
        }
        poolManager.unlock(abi.encode(int(uint(_liquidity))));
    }

    function collect() external {
        poolManager.unlock(abi.encode(int(0)));
    }

    function withdraw() external auth {
        if (!withdrawable) revert Error.LiquidityLock__Permanent();
        (uint128 _base,,) = poolManager.getPositionInfo(
            _poolKey().toId(),
            address(this),
            TickMath.minUsableTick(tickSpacing),
            TickMath.maxUsableTick(tickSpacing),
            bytes32(0)
        );
        if (_base != 0) poolManager.unlock(abi.encode(-int(uint(_base))));
        Address.sendValue(payable(foundation), address(this).balance);
        IERC20(puppet).safeTransfer(foundation, IERC20(puppet).balanceOf(address(this)));
    }

    function unlockCallback(
        bytes calldata _data
    ) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert Error.LiquidityLock__Forbidden(msg.sender);
        PoolKey memory _key = _poolKey();
        int _liquidityDelta = abi.decode(_data, (int));
        (BalanceDelta _delta, BalanceDelta _fees) = poolManager.modifyLiquidity(
            _key,
            ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(tickSpacing),
                tickUpper: TickMath.maxUsableTick(tickSpacing),
                liquidityDelta: _liquidityDelta,
                salt: bytes32(0)
            }),
            ""
        );
        if (_liquidityDelta < 0) {
            _key.currency0.take(poolManager, foundation, uint(int(_delta.amount0())), false);
            _key.currency1.take(poolManager, foundation, uint(int(_delta.amount1())), false);
        } else {
            _key.currency0.take(poolManager, foundation, uint(int(_fees.amount0())), false);
            _key.currency1.take(poolManager, foundation, uint(int(_fees.amount1())), false);
            _key.currency0.settle(poolManager, address(this), uint(int(_fees.amount0()) - int(_delta.amount0())), false);
            _key.currency1.settle(poolManager, address(this), uint(int(_fees.amount1()) - int(_delta.amount1())), false);
        }
        return "";
    }

    function _poolKey() internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(puppet),
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(address(hook))
        });
    }
}
