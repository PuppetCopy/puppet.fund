// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BankStore} from "../../utils/BankStore.sol";
import {IAuthority} from "../../utils/interfaces/IAuthority.sol";

contract RedeemStore is BankStore {
    struct Pool {
        uint epoch;
        uint accruedPerWeight;
        uint weight;
    }

    struct Position {
        uint epoch;
        uint weight;
        uint cursor;
    }

    mapping(address fund => Pool) public poolMap;
    mapping(address fund => mapping(address holder => Position)) public positionMap;
    mapping(address fund => mapping(uint epoch => uint)) public closedEpochAccruedMap;
    mapping(address fund => uint) public liquidationRateMap;

    constructor(
        IAuthority _authority
    ) BankStore(_authority) {}

    function getPool(
        address _fund
    ) external view returns (Pool memory) {
        return poolMap[_fund];
    }

    function getPosition(
        address _fund,
        address _holder
    ) external view returns (Position memory) {
        return positionMap[_fund][_holder];
    }

    function setPool(
        address _fund,
        Pool calldata _pool
    ) external auth {
        poolMap[_fund] = _pool;
    }

    function setPosition(
        address _fund,
        address _holder,
        Position calldata _position
    ) external auth {
        positionMap[_fund][_holder] = _position;
    }

    function setLiquidationRate(
        address _fund,
        uint _liquidationRate
    ) external auth {
        liquidationRateMap[_fund] = _liquidationRate;
    }

    function recognize(
        IERC20 _token,
        uint _amount
    ) external auth {
        signedBalanceMap[_token] += _amount;
    }

    function setClosedEpochAccrued(
        address _fund,
        uint _epoch,
        uint _accruedPerWeight
    ) external auth {
        closedEpochAccruedMap[_fund][_epoch] = _accruedPerWeight;
    }

    function transferOut(
        IERC20 _token,
        address _receiver,
        uint _amount,
        uint _gasLimit
    ) external auth {
        _transferOut(_token, _receiver, _amount, _gasLimit);
    }
}
