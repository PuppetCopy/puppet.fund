// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
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
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {Error} from "../utils/Error.sol";
import {Access} from "../utils/auth/Access.sol";
import {OracleHook} from "./OracleHook.sol";

contract LiquidityRange is Access, IUnlockCallback {
    using CurrencySettler for Currency;
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;

    IPoolManager public immutable poolManager;
    OracleHook public immutable hook;
    address public immutable puppet;
    uint24 public immutable fee;
    int24 public immutable tickSpacing;
    address public immutable foundation;
    uint32 public immutable twapWindow;
    int24 public immutable maxTickDeviation;
    int24 public immutable baseWidth;
    int24 public immutable limitWidth;
    uint32 public immutable period;
    int24 public immutable minTickMove;

    int24 public center;
    uint32 public lastRebalance;

    constructor(
        address _authority,
        IPoolManager _poolManager,
        OracleHook _hook,
        address _puppet,
        uint24 _fee,
        int24 _tickSpacing,
        address _foundation,
        uint32 _twapWindow,
        int24 _maxTickDeviation,
        int24 _baseWidth,
        int24 _limitWidth,
        uint32 _period,
        int24 _minTickMove
    ) Access(_authority) {
        if (
            address(_poolManager) == address(0) || address(_hook) == address(0) || _puppet == address(0)
                || _fee > LPFeeLibrary.MAX_LP_FEE || _tickSpacing < TickMath.MIN_TICK_SPACING
                || _tickSpacing > TickMath.MAX_TICK_SPACING || _foundation == address(0) || _twapWindow == 0
                || _maxTickDeviation <= 0 || _baseWidth < _tickSpacing || _baseWidth % _tickSpacing != 0
                || _limitWidth <= 0 || _limitWidth % _tickSpacing != 0 || _minTickMove < 0
        ) {
            revert Error.LiquidityRange__InvalidConfig();
        }
        poolManager = _poolManager;
        hook = _hook;
        puppet = _puppet;
        fee = _fee;
        tickSpacing = _tickSpacing;
        foundation = _foundation;
        twapWindow = _twapWindow;
        maxTickDeviation = _maxTickDeviation;
        baseWidth = _baseWidth;
        limitWidth = _limitWidth;
        period = _period;
        minTickMove = _minTickMove;
    }

    receive() external payable {}

    function rebalance() external {
        PoolId _id = _poolKey().toId();
        uint32[] memory _secondsAgoList = new uint32[](2);
        _secondsAgoList[0] = twapWindow;
        (, int56[] memory _truncatedList) = hook.observe(_secondsAgoList, _id);
        int56 _tickDelta = _truncatedList[1] - _truncatedList[0];
        int24 _twap = int24(_tickDelta / int56(uint56(twapWindow)));
        if (_tickDelta < 0 && _tickDelta % int56(uint56(twapWindow)) != 0) _twap -= 1;
        (, int24 _spot,,) = poolManager.getSlot0(_id);
        if (SignedMath.abs(int(_spot) - int(_twap)) > uint(int(maxTickDeviation))) {
            revert Error.LiquidityRange__OffMarket(_spot, _twap);
        }
        int24 _center = center;
        (uint128 _base,,) =
            poolManager.getPositionInfo(_id, address(this), _center - baseWidth, _center + baseWidth, bytes32(0));
        (uint128 _ask,,) = poolManager.getPositionInfo(_id, address(this), _center - limitWidth, _center, bytes32(0));
        (uint128 _bid,,) = poolManager.getPositionInfo(
            _id, address(this), _center + tickSpacing, _center + tickSpacing + limitWidth, bytes32(0)
        );
        int24 _next = _spot / tickSpacing * tickSpacing;
        if (_spot < 0 && _spot % tickSpacing != 0) _next -= tickSpacing;
        if (_base != 0 || _ask != 0 || _bid != 0) {
            if (block.timestamp < uint(lastRebalance) + period) {
                revert Error.LiquidityRange__TooSoon(uint(lastRebalance) + period);
            }
            if (SignedMath.abs(int(_next) - int(_center)) < uint(int(minTickMove))) {
                revert Error.LiquidityRange__Unmoved(_next, _center);
            }
        }
        center = _next;
        lastRebalance = uint32(block.timestamp);
        poolManager.unlock(abi.encode(_center, _base, _ask, _bid, true));
    }

    function withdraw() external auth {
        PoolId _id = _poolKey().toId();
        int24 _center = center;
        (uint128 _base,,) =
            poolManager.getPositionInfo(_id, address(this), _center - baseWidth, _center + baseWidth, bytes32(0));
        (uint128 _ask,,) = poolManager.getPositionInfo(_id, address(this), _center - limitWidth, _center, bytes32(0));
        (uint128 _bid,,) = poolManager.getPositionInfo(
            _id, address(this), _center + tickSpacing, _center + tickSpacing + limitWidth, bytes32(0)
        );
        poolManager.unlock(abi.encode(_center, _base, _ask, _bid, false));
        Address.sendValue(payable(foundation), address(this).balance);
        IERC20(puppet).safeTransfer(foundation, IERC20(puppet).balanceOf(address(this)));
    }

    function unlockCallback(
        bytes calldata _data
    ) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert Error.LiquidityRange__Forbidden(msg.sender);
        (int24 _old, uint128 _base, uint128 _ask, uint128 _bid, bool _place) =
            abi.decode(_data, (int24, uint128, uint128, uint128, bool));
        PoolKey memory _key = _poolKey();
        int _eth;
        int _puppet;
        if (_base != 0) {
            (BalanceDelta _delta,) = poolManager.modifyLiquidity(
                _key,
                ModifyLiquidityParams({
                    tickLower: _old - baseWidth,
                    tickUpper: _old + baseWidth,
                    liquidityDelta: -int(uint(_base)),
                    salt: bytes32(0)
                }),
                ""
            );
            _eth += _delta.amount0();
            _puppet += _delta.amount1();
        }
        if (_ask != 0) {
            (BalanceDelta _delta,) = poolManager.modifyLiquidity(
                _key,
                ModifyLiquidityParams({
                    tickLower: _old - limitWidth, tickUpper: _old, liquidityDelta: -int(uint(_ask)), salt: bytes32(0)
                }),
                ""
            );
            _eth += _delta.amount0();
            _puppet += _delta.amount1();
        }
        if (_bid != 0) {
            (BalanceDelta _delta,) = poolManager.modifyLiquidity(
                _key,
                ModifyLiquidityParams({
                    tickLower: _old + tickSpacing,
                    tickUpper: _old + tickSpacing + limitWidth,
                    liquidityDelta: -int(uint(_bid)),
                    salt: bytes32(0)
                }),
                ""
            );
            _eth += _delta.amount0();
            _puppet += _delta.amount1();
        }
        if (_place) {
            int24 _center = center;
            {
                (uint160 _sqrtPrice,,,) = poolManager.getSlot0(_key.toId());
                uint160 _lower = TickMath.getSqrtPriceAtTick(_center - baseWidth);
                uint160 _upper = TickMath.getSqrtPriceAtTick(_center + baseWidth);
                uint _heldEth = uint(int(address(this).balance) + _eth);
                uint128 _liquidity = SafeCast.toUint128(
                    Math.min(
                        _heldEth > 1
                            ? Math.mulDiv(Math.mulDiv(_heldEth - 1, _sqrtPrice, 1 << 96), _upper, _upper - _sqrtPrice)
                            : 0,
                        Math.mulDiv(
                            uint(int(IERC20(puppet).balanceOf(address(this))) + _puppet), 1 << 96, _sqrtPrice - _lower
                        )
                    )
                );
                if (_liquidity != 0) {
                    (BalanceDelta _delta,) = poolManager.modifyLiquidity(
                        _key,
                        ModifyLiquidityParams({
                            tickLower: _center - baseWidth,
                            tickUpper: _center + baseWidth,
                            liquidityDelta: int(uint(_liquidity)),
                            salt: bytes32(0)
                        }),
                        ""
                    );
                    _eth += _delta.amount0();
                    _puppet += _delta.amount1();
                }
            }
            {
                uint160 _lower = TickMath.getSqrtPriceAtTick(_center - limitWidth);
                uint160 _upper = TickMath.getSqrtPriceAtTick(_center);
                uint128 _liquidity = SafeCast.toUint128(
                    Math.mulDiv(uint(int(IERC20(puppet).balanceOf(address(this))) + _puppet), 1 << 96, _upper - _lower)
                );
                if (_liquidity != 0) {
                    (BalanceDelta _delta,) = poolManager.modifyLiquidity(
                        _key,
                        ModifyLiquidityParams({
                            tickLower: _center - limitWidth,
                            tickUpper: _center,
                            liquidityDelta: int(uint(_liquidity)),
                            salt: bytes32(0)
                        }),
                        ""
                    );
                    _eth += _delta.amount0();
                    _puppet += _delta.amount1();
                }
            }
            {
                uint160 _lower = TickMath.getSqrtPriceAtTick(_center + tickSpacing);
                uint160 _upper = TickMath.getSqrtPriceAtTick(_center + tickSpacing + limitWidth);
                uint _heldEth = uint(int(address(this).balance) + _eth);
                uint128 _liquidity = _heldEth > 1
                    ? SafeCast.toUint128(
                        Math.mulDiv(Math.mulDiv(_heldEth - 1, _lower, 1 << 96), _upper, _upper - _lower)
                    )
                    : 0;
                if (_liquidity != 0) {
                    (BalanceDelta _delta,) = poolManager.modifyLiquidity(
                        _key,
                        ModifyLiquidityParams({
                            tickLower: _center + tickSpacing,
                            tickUpper: _center + tickSpacing + limitWidth,
                            liquidityDelta: int(uint(_liquidity)),
                            salt: bytes32(0)
                        }),
                        ""
                    );
                    _eth += _delta.amount0();
                    _puppet += _delta.amount1();
                }
            }
        }
        if (_eth < 0) _key.currency0.settle(poolManager, address(this), uint(-_eth), false);
        else if (_eth > 0) _key.currency0.take(poolManager, address(this), uint(_eth), false);
        if (_puppet < 0) _key.currency1.settle(poolManager, address(this), uint(-_puppet), false);
        else if (_puppet > 0) _key.currency1.take(poolManager, address(this), uint(_puppet), false);
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
